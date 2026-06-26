import copy
import struct
import sys
import unittest
from pathlib import Path


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REFERENCE_ROOT))

from ssklib.error import SSKError
from ssklib.api import document_differences
from ssklib.parse_ssk import parse as parse_ssk
from ssklib.parse_sskb import parse as parse_sskb
from ssklib.resolve import resolve
from ssklib.validate import validate
from ssklib.write_ssk import write as write_ssk
from ssklib.write_sskb import write as write_sskb


def piece(piece_id=0, **overrides):
    value = {
        'id': piece_id,
        'points': [{'x': 0, 'y': 0, 'z': 0}],
        'size': {'x': 1, 'y': 1, 'z': 1},
        'shape': 'circle',
    }
    value.update(overrides)
    return value


class SSKParserTests(unittest.TestCase):
    def test_reference_python_sources_compile(self):
        for path in REFERENCE_ROOT.rglob('*.py'):
            source = path.read_text(encoding='utf-8')
            compile(source, str(path), 'exec')

    def test_rejects_duplicate_keys(self):
        with self.assertRaisesRegex(SSKError, 'duplicate mapping key'):
            parse_ssk('pieces: []\npieces: []\n')

    def test_rejects_aliases_and_anchors(self):
        text = '''
pieces:
  - &base
    id: 0
    points: [{x: 0, y: 0, z: 0}]
    size: {x: 1, y: 1, z: 1}
    shape: circle
  - *base
'''
        with self.assertRaisesRegex(SSKError, 'anchors|aliases'):
            parse_ssk(text)

    def test_rejects_directives(self):
        with self.assertRaisesRegex(SSKError, 'directives'):
            parse_ssk('%YAML 1.2\n---\npieces: []\n')

    def test_allows_percent_in_block_scalar_property(self):
        doc = parse_ssk('pieces: []\nproperties:\n  note: |\n    %not a directive\n')
        self.assertEqual(doc['properties']['note'], '%not a directive\n')

    def test_rejects_bool_as_number(self):
        text = '''
pieces:
  - id: 0
    points:
      - {x: true, y: 0, z: 0}
    size: {x: 1, y: 1, z: 1}
    shape: circle
'''
        with self.assertRaisesRegex(SSKError, 'booleans are not valid numbers'):
            parse_ssk(text)


class InheritanceAndValidationTests(unittest.TestCase):
    def test_resolve_can_leave_input_unchanged(self):
        doc = {'pieces': [piece(0), {'id': 1, 'from': 0}]}
        original = copy.deepcopy(doc)

        resolved = resolve(doc, in_place=False)

        self.assertEqual(doc, original)
        self.assertIn('points', resolved['pieces'][1])
        validate(resolved)

    def test_resolve_rejects_duplicate_ids_before_mapping(self):
        doc = {'pieces': [piece(0), piece(0)]}
        with self.assertRaisesRegex(SSKError, 'unique'):
            resolve(doc)

    def test_validate_rejects_bool_from_library_callers(self):
        doc = {'pieces': [piece(0, points=[{'x': False, 'y': 0, 'z': 0}])]}
        with self.assertRaisesRegex(SSKError, 'booleans are not valid numbers|finite number'):
            validate(doc)

    def test_write_ssk_round_trip(self):
        doc = {'pieces': [piece(0, properties={'name': 'round-trip'})]}
        self.assertEqual([], document_differences(doc, parse_ssk(write_ssk(doc))))


class SSKBBinaryTests(unittest.TestCase):
    def test_round_trip_preserves_explicit_empty_inherited_properties(self):
        doc = {
            'pieces': [
                piece(0, properties={'name': 'base'}),
                {'id': 1, 'from': 0, 'properties': {}},
            ]
        }

        parsed = parse_sskb(write_sskb(doc))
        self.assertEqual(parsed['pieces'][1]['properties'], {})

        resolved = resolve(parsed, in_place=False)
        self.assertEqual(resolved['pieces'][1]['properties'], {})

    def test_rejects_non_mapping_property_blob(self):
        data = b'SSKB' + struct.pack('<HHI', 1, 0, 0) + struct.pack('<I', 1) + b' '
        with self.assertRaisesRegex(SSKError, 'property blob must be a YAML mapping'):
            parse_sskb(data)

    def test_rejects_piece_count_that_exceeds_remaining_input(self):
        data = b'SSKB' + struct.pack('<HHI', 1, 0, 2) + struct.pack('<I', 0)
        with self.assertRaisesRegex(SSKError, 'count 2 exceeds remaining input'):
            parse_sskb(data)

    def test_writer_raises_domain_error_for_invalid_models(self):
        doc = {'pieces': [piece(-1)]}
        with self.assertRaises(SSKError):
            write_sskb(doc)


if __name__ == '__main__':
    unittest.main()
