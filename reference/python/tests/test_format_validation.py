import struct
import sys
import unittest
from pathlib import Path


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REFERENCE_ROOT))

from ssklib.api import document_differences
from ssklib.error import SSKError
from ssklib.parse_ssk import parse as parse_ssk
from ssklib.parse_sskb import parse as parse_sskb
from ssklib.write_sskb import write as write_sskb


def _u8(value: int) -> bytes:
    return struct.pack('<B', value)


def _u16(value: int) -> bytes:
    return struct.pack('<H', value)


def _u32(value: int) -> bytes:
    return struct.pack('<I', value)


def _f32(value: float) -> bytes:
    return struct.pack('<f', value)


def _minimal_point() -> bytes:
    return b''.join([
        _f32(0), _f32(0), _f32(0),
        _u8(0), _u8(0), _u8(0), _u8(0), _u8(0), _u8(0),
    ])


def _minimal_piece(*, shape: int = 0, mode: int = 0) -> bytes:
    return b''.join([
        _u32(0),
        _u8(0),
        _u32(1),
        _minimal_point(),
        _u8(0),
        _f32(1), _f32(1), _f32(1),
        _u8(shape),
        _u8(0),
        _u8(mode),
        _u8(0),
        _u32(0),
    ])


def _inherited_piece_with_field_mask(mask: int) -> bytes:
    return b''.join([
        _u32(1),
        _u8(1),
        _u32(0),
        _u16(mask),
    ])


def _sskb(*pieces: bytes, major: int = 1, minor: int = 0, root_properties: bytes = b'') -> bytes:
    return b''.join([
        b'SSKB',
        _u16(major),
        _u16(minor),
        _u32(len(pieces)),
        *pieces,
        _u32(len(root_properties)),
        root_properties,
    ])


def _document() -> dict:
    return {
        'pieces': [{
            'id': 0,
            'points': [{'x': 0, 'y': 0, 'z': 0}],
            'size': {'x': 1, 'y': 1, 'z': 1},
            'shape': 'circle',
            'properties': {'name': 'base', 'weights': [1, 2.5, None]},
        }],
        'properties': {'meta': {'enabled': True, 'label': 'round-trip'}},
    }


class SSKTextFormatValidationTests(unittest.TestCase):
    def test_accepts_crlf_and_comments(self):
        text = (
            '# comment\r\n'
            'pieces:\r\n'
            '  - id: 0\r\n'
            '    points: [{x: 0, y: 0, z: 0}]\r\n'
            '    size: {x: 1, y: 1, z: 1}\r\n'
            '    shape: circle\r\n'
        )
        self.assertEqual(0, parse_ssk(text)['pieces'][0]['id'])

    def test_rejects_unknown_point_fields(self):
        text = '''
pieces:
  - id: 0
    points: [{x: 0, y: 0, z: 0, w: 0}]
    size: {x: 1, y: 1, z: 1}
    shape: circle
'''
        with self.assertRaisesRegex(SSKError, 'unknown field'):
            parse_ssk(text)

    def test_rejects_non_finite_numbers(self):
        text = '''
pieces:
  - id: 0
    points: [{x: .nan, y: 0, z: 0}]
    size: {x: 1, y: 1, z: 1}
    shape: circle
'''
        with self.assertRaisesRegex(SSKError, 'finite'):
            parse_ssk(text)

    def test_rejects_boolean_integer_fields(self):
        text = '''
pieces:
  - id: true
    points: [{x: 0, y: 0, z: 0}]
    size: {x: 1, y: 1, z: 1}
    shape: circle
'''
        with self.assertRaisesRegex(SSKError, 'booleans are not valid integers'):
            parse_ssk(text)

    def test_rejects_nested_non_string_property_keys(self):
        with self.assertRaisesRegex(SSKError, 'property keys must be strings'):
            parse_ssk('pieces: []\nproperties:\n  meta:\n    1: value\n')

    def test_rejects_unsupported_major_version(self):
        with self.assertRaisesRegex(SSKError, 'unsupported major version'):
            parse_ssk('version: "2.0"\npieces: []\n')

    def test_accepts_legacy_major_version(self):
        doc = parse_ssk('version: "0.9"\npieces: []\n')
        self.assertEqual('0.9', doc['version'])


class SSKBBinaryFormatValidationTests(unittest.TestCase):
    def test_allows_unknown_minor_version(self):
        self.assertEqual({'pieces': []}, parse_sskb(_sskb(minor=65535)))

    def test_rejects_bad_magic(self):
        with self.assertRaisesRegex(SSKError, 'bad sskb magic'):
            parse_sskb(b'NOPE' + _sskb()[4:])

    def test_rejects_unsupported_major_version(self):
        with self.assertRaisesRegex(SSKError, 'unsupported sskb major version'):
            parse_sskb(_sskb(major=2))

    def test_accepts_legacy_major_version(self):
        self.assertEqual({'pieces': []}, parse_sskb(_sskb(major=0, minor=9)))

    def test_rejects_reserved_inherited_field_mask_bits(self):
        with self.assertRaisesRegex(SSKError, 'reserved field_mask bits'):
            parse_sskb(_sskb(_inherited_piece_with_field_mask(0x0100)))

    def test_rejects_invalid_shape_enum(self):
        with self.assertRaisesRegex(SSKError, 'invalid shape enum 99'):
            parse_sskb(_sskb(_minimal_piece(shape=99)))

    def test_rejects_invalid_mode_enum(self):
        with self.assertRaisesRegex(SSKError, 'invalid mode enum 99'):
            parse_sskb(_sskb(_minimal_piece(mode=99)))

    def test_rejects_invalid_utf8_property_blob(self):
        with self.assertRaisesRegex(SSKError, 'property blob not valid UTF-8'):
            parse_sskb(_sskb(root_properties=b'\xff'))

    def test_rejects_duplicate_property_blob_keys(self):
        with self.assertRaisesRegex(SSKError, 'duplicate mapping key'):
            parse_sskb(_sskb(root_properties=b'name: one\nname: two\n'))

    def test_writer_output_round_trips_semantically(self):
        source = _document()
        decoded = parse_sskb(write_sskb(source))
        self.assertEqual([], document_differences(source, decoded))

    def test_writer_defaults_to_current_sskb_version(self):
        major, minor = struct.unpack('<HH', write_sskb({'pieces': []})[4:8])
        self.assertEqual((1, 0), (major, minor))

    def test_writer_preserves_legacy_document_version(self):
        major, minor = struct.unpack('<HH', write_sskb({'version': '0.9', 'pieces': []})[4:8])
        self.assertEqual((0, 9), (major, minor))


if __name__ == '__main__':
    unittest.main()
