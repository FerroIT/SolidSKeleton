import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = REFERENCE_ROOT.parents[2]
EXAMPLES_ROOT = REPO_ROOT / 'examples'
sys.path.insert(0, str(REFERENCE_ROOT))

from ssklib.api import document_differences, load, mesh_document, validate_document
from ssklib.gltf import write_glb, write_gltf
from ssklib.parse_sskb import parse as parse_sskb
from ssklib.write_sskb import write as write_sskb


SWEEP_RESOLUTION = 32


def example_format_files() -> list[Path]:
    return sorted(
        path for path in EXAMPLES_ROOT.rglob('*')
        if path.suffix.lower() in {'.ssk', '.sskb'}
    )


def write_example_sweep(output_root: Path) -> dict:
    output_root.mkdir(parents=True, exist_ok=True)
    rows = []

    for source_path in example_format_files():
        doc = load(source_path)
        resolved = validate_document(doc)
        roundtrip_bytes = write_sskb(doc)
        differences = document_differences(doc, parse_sskb(roundtrip_bytes))
        if differences:
            raise AssertionError(f"{source_path.relative_to(REPO_ROOT)} round-trip differences: {differences}")

        relative_source = source_path.relative_to(EXAMPLES_ROOT)
        target_dir = output_root / relative_source.parent
        target_dir.mkdir(parents=True, exist_ok=True)

        prefix = f"{source_path.stem}.{source_path.suffix.lower().lstrip('.')}"
        parsed_json_path = target_dir / f"{prefix}.parsed.json"
        roundtrip_path = target_dir / f"{prefix}.roundtrip.sskb"
        glb_path = target_dir / f"{prefix}.mesh.glb"
        gltf_path = target_dir / f"{prefix}.mesh.gltf"
        gltf_bin_path = gltf_path.with_suffix('.bin')

        vertices, faces = mesh_document(resolved, resolution=SWEEP_RESOLUTION)
        if vertices is None or faces is None or len(faces) == 0:
            raise AssertionError(f"{source_path.relative_to(REPO_ROOT)} produced empty mesh")

        write_glb(vertices, faces, str(glb_path))
        write_gltf(vertices, faces, str(gltf_path))
        glb_summary = _read_glb_summary(glb_path)
        gltf_summary = _read_gltf_summary(gltf_path)

        row = {
            'source': relative_source.as_posix(),
            'encoding': source_path.suffix.lower().lstrip('.'),
            'source_bytes': source_path.stat().st_size,
            'piece_count': len(resolved['pieces']),
            'roundtrip_sskb_bytes': len(roundtrip_bytes),
            'roundtrip_sskb_version': _sskb_version(roundtrip_bytes),
            'vertex_count': len(vertices),
            'triangle_count': len(faces),
            'parsed_json': parsed_json_path.relative_to(output_root).as_posix(),
            'roundtrip_sskb': roundtrip_path.relative_to(output_root).as_posix(),
            'glb': glb_path.relative_to(output_root).as_posix(),
            'glb_bytes': glb_path.stat().st_size,
            'glb_json_bytes': glb_summary['json_bytes'],
            'glb_bin_bytes': glb_summary['bin_bytes'],
            'gltf': gltf_path.relative_to(output_root).as_posix(),
            'gltf_bytes': gltf_path.stat().st_size,
            'gltf_bin': gltf_bin_path.relative_to(output_root).as_posix(),
            'gltf_bin_bytes': gltf_bin_path.stat().st_size,
            'gltf_declared_bin_bytes': gltf_summary['declared_bin_bytes'],
        }

        parsed_json_path.write_text(
            json.dumps({'summary': row, 'document': doc}, indent=2, sort_keys=True) + '\n',
            encoding='utf-8',
        )
        roundtrip_path.write_bytes(roundtrip_bytes)

        row['parsed_json_bytes'] = parsed_json_path.stat().st_size
        rows.append(row)

    manifest = {
        'file_count': len(rows),
        'source_bytes': sum(row['source_bytes'] for row in rows),
        'parsed_json_bytes': sum(row['parsed_json_bytes'] for row in rows),
        'roundtrip_sskb_bytes': sum(row['roundtrip_sskb_bytes'] for row in rows),
        'glb_bytes': sum(row['glb_bytes'] for row in rows),
        'gltf_bytes': sum(row['gltf_bytes'] for row in rows),
        'gltf_bin_bytes': sum(row['gltf_bin_bytes'] for row in rows),
        'files': rows,
    }
    (output_root / 'manifest.json').write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    return manifest


def _sskb_version(data: bytes) -> str:
    return f"{int.from_bytes(data[4:6], 'little')}.{int.from_bytes(data[6:8], 'little')}"


def _read_glb_summary(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 28:
        raise AssertionError(f"{path} is too short to be GLB")
    magic, version, declared_length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise AssertionError(f"{path} has invalid GLB magic")
    if version != 2:
        raise AssertionError(f"{path} has invalid GLB version {version}")
    if declared_length != len(data):
        raise AssertionError(f"{path} declares {declared_length} bytes, actual {len(data)}")

    json_length, json_type = struct.unpack_from('<II', data, 12)
    if json_type != 0x4E4F534A:
        raise AssertionError(f"{path} missing JSON chunk")
    json_start = 20
    json_end = json_start + json_length
    json.loads(data[json_start:json_end].decode('utf-8').rstrip(' '))

    bin_length, bin_type = struct.unpack_from('<II', data, json_end)
    if bin_type != 0x004E4942:
        raise AssertionError(f"{path} missing BIN chunk")
    if json_end + 8 + bin_length != len(data):
        raise AssertionError(f"{path} has trailing GLB bytes")
    return {'json_bytes': json_length, 'bin_bytes': bin_length}


def _read_gltf_summary(path: Path) -> dict:
    doc = json.loads(path.read_text(encoding='utf-8'))
    if doc.get('asset', {}).get('version') != '2.0':
        raise AssertionError(f"{path} is not glTF 2.0")
    buffer_entry = doc.get('buffers', [{}])[0]
    bin_uri = buffer_entry.get('uri')
    if not isinstance(bin_uri, str):
        raise AssertionError(f"{path} does not reference a BIN file")
    bin_path = path.with_name(bin_uri)
    if not bin_path.is_file():
        raise AssertionError(f"{path} references missing BIN file {bin_uri}")
    declared_bytes = buffer_entry.get('byteLength')
    if declared_bytes != bin_path.stat().st_size:
        raise AssertionError(f"{path} BIN byte length mismatch")
    return {'declared_bin_bytes': declared_bytes}


class ExampleSweepTests(unittest.TestCase):
    def test_all_examples_export_to_placeholder_sweep_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            manifest = write_example_sweep(output_root)

            self.assertEqual(22, manifest['file_count'])
            self.assertGreater(manifest['source_bytes'], 0)
            self.assertGreater(manifest['parsed_json_bytes'], manifest['source_bytes'])
            self.assertGreater(manifest['roundtrip_sskb_bytes'], 0)
            self.assertGreater(manifest['glb_bytes'], 0)
            self.assertGreater(manifest['gltf_bytes'], 0)
            self.assertGreater(manifest['gltf_bin_bytes'], 0)

            encodings = {row['encoding'] for row in manifest['files']}
            self.assertEqual({'ssk', 'sskb'}, encodings)
            for row in manifest['files']:
                with self.subTest(path=row['source']):
                    self.assertGreater(row['source_bytes'], 0)
                    self.assertGreater(row['parsed_json_bytes'], 0)
                    self.assertGreater(row['roundtrip_sskb_bytes'], 0)
                    self.assertGreater(row['vertex_count'], 0)
                    self.assertGreater(row['triangle_count'], 0)
                    self.assertGreater(row['glb_bytes'], 0)
                    self.assertGreater(row['glb_json_bytes'], 0)
                    self.assertGreater(row['glb_bin_bytes'], 0)
                    self.assertGreater(row['gltf_bytes'], 0)
                    self.assertGreater(row['gltf_bin_bytes'], 0)
                    self.assertEqual(row['glb_bin_bytes'], row['gltf_bin_bytes'])
                    self.assertEqual(row['gltf_declared_bin_bytes'], row['gltf_bin_bytes'])
                    self.assertEqual('1.0', row['roundtrip_sskb_version'])
                    self.assertTrue((output_root / row['parsed_json']).is_file())
                    self.assertTrue((output_root / row['roundtrip_sskb']).is_file())
                    self.assertTrue((output_root / row['glb']).is_file())
                    self.assertTrue((output_root / row['gltf']).is_file())
                    self.assertTrue((output_root / row['gltf_bin']).is_file())


if __name__ == '__main__':
    unittest.main()
