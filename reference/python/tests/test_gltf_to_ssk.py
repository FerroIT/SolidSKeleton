import contextlib
import io
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

REFERENCE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REFERENCE_ROOT))

from ssklib.api import convert, import_gltf_to_ssk, load, mesh_document, validate_document
from ssklib.cli import main as cli_main
from ssklib.gltf import write_glb
from ssklib.parse_ssk import parse as parse_ssk
from ssklib.parse_sskb import parse as parse_sskb
from ssklib.write_sskb import write as write_sskb


def _write_mesh_glb(mesh: trimesh.Trimesh, path: Path):
    write_glb(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces, dtype=np.int32), str(path))


def _box(extents=(1.0, 1.0, 1.0), translation=(0.0, 0.0, 0.0)):
    mesh = trimesh.creation.box(extents=extents)
    mesh.apply_translation(translation)
    return mesh


def _cylinder(radius=0.35, height=1.6):
    return trimesh.creation.cylinder(radius=radius, height=height, sections=48)


def _sphere(radius=0.5):
    return trimesh.creation.icosphere(subdivisions=3, radius=radius)


def _torus():
    return trimesh.creation.torus(major_radius=0.75, minor_radius=0.18, major_sections=64, minor_sections=16)


def _ladder():
    parts = [
        _box((0.08, 0.08, 2.0), (-0.35, 0.0, 0.0)),
        _box((0.08, 0.08, 2.0), (0.35, 0.0, 0.0)),
    ]
    for z in np.linspace(-0.75, 0.75, 5):
        parts.append(_box((0.7, 0.07, 0.07), (0.0, 0.0, float(z))))
    return trimesh.util.concatenate(parts)


class GltfToSskTests(unittest.TestCase):
    def _convert_mesh(self, mesh, output_suffix='.ssk', **kwargs):
        with tempfile.TemporaryDirectory() as temp_dir:
            glb = Path(temp_dir) / 'source.glb'
            out = Path(temp_dir) / f'out{output_suffix}'
            _write_mesh_glb(mesh, glb)
            result = convert(glb, out, **kwargs)
            self.assertTrue(out.is_file())
            if output_suffix == '.ssk':
                doc = parse_ssk(out.read_text(encoding='utf-8'))
            else:
                doc = parse_sskb(out.read_bytes())
            validate_document(doc)
            return result, doc, out.read_bytes()

    def test_glb_to_ssk_produces_valid_ssk_without_root_properties(self):
        result, doc, _ = self._convert_mesh(_box())
        self.assertEqual('ssk', result.output_format)
        self.assertNotIn('properties', doc)
        self.assertEqual([piece['id'] for piece in doc['pieces']], list(range(len(doc['pieces']))))

    def test_glb_to_sskb_produces_valid_sskb(self):
        result, doc, raw = self._convert_mesh(_sphere(), '.sskb')
        self.assertEqual('sskb', result.output_format)
        self.assertGreater(len(raw), 16)
        self.assertGreaterEqual(result.coverage_percent, 80.0)
        self.assertLess(result.overfill_percent, 35.0)

    def test_generated_ssk_can_convert_back_to_glb(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'cube.glb'
            ssk = Path(temp_dir) / 'cube.ssk'
            glb = Path(temp_dir) / 'roundtrip.glb'
            _write_mesh_glb(_box(), source)
            convert(source, ssk)
            result = convert(ssk, glb, resolution=8)
            self.assertTrue(glb.is_file())
            self.assertEqual('glb', result.output_format)
            self.assertGreater(result.triangle_count, 0)

    def test_no_expected_count_recovers_ladder_structure_instead_of_one_piece(self):
        result, doc, _ = self._convert_mesh(_ladder())
        self.assertGreater(result.piece_count, 1)
        self.assertGreaterEqual(result.coverage_percent, 75.0)
        self.assertLess(result.overfill_percent, 80.0)

    def test_expected_piece_count_above_32_does_not_crash_and_is_soft(self):
        result, doc, _ = self._convert_mesh(_ladder(), expected_piece_count=42)
        self.assertGreater(result.piece_count, 1)
        self.assertNotEqual(42, result.piece_count)
        self.assertGreaterEqual(result.coverage_percent, 70.0)

    def test_cli_accepts_expected_piece_count_option(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'ladder.glb'
            target = Path(temp_dir) / 'ladder.sskb'
            _write_mesh_glb(_ladder(), source)
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(0, cli_main(['convert', str(source), str(target), '--expected-piece-count', '42']))
            self.assertTrue(target.is_file())
            text = stdout.getvalue()
            self.assertIn('coverage', text)
            self.assertIn('overfill', text)

    def test_coverage_and_overfill_are_reported_and_penalize_giant_box(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'donut.glb'
            _write_mesh_glb(_torus(), source)
            imported = import_gltf_to_ssk(source)
            giant = {
                'pieces': [{
                    'id': 0,
                    'points': [{'x': -1000, 'y': 0, 'z': 0}, {'x': 1000, 'y': 0, 'z': 0}],
                    'size': {'x': 1600, 'y': 1600, 'z': 0},
                    'rotation': {'x': 0, 'y': 0, 'z': 45},
                    'shape': 'ngon',
                    'sides': 4,
                }]
            }
            giant_quality = imported.score_document(giant)
            self.assertGreater(imported.coverage_percent, 60.0)
            self.assertGreater(imported.score, giant_quality.score)
            self.assertGreater(giant_quality.overfill_percent, imported.overfill_percent)

    def test_ladder_recovers_semantic_sweeps_with_inheritance(self):
        result, doc, _ = self._convert_mesh(_ladder(), expected_piece_count=6)
        self.assertGreaterEqual(sum(1 for p in doc['pieces'] if len(p.get('points', [])) >= 2), 6)
        self.assertGreaterEqual(sum(1 for p in doc['pieces'] if 'from' in p), 3)

    def test_torus_does_not_become_one_giant_box(self):
        result, doc, _ = self._convert_mesh(_torus())
        self.assertTrue(any(p.get('shape') == 'circle' and any('curve_in' in pt or 'curve_out' in pt for pt in p.get('points', [])) for p in doc['pieces']))
        self.assertLess(result.overfill_percent, 100.0)

    def test_cube_recovers_close_one_piece_ngon_sweep(self):
        result, doc, _ = self._convert_mesh(_box())
        self.assertEqual(1, result.piece_count)
        piece = doc['pieces'][0]
        self.assertEqual('ngon', piece['shape'])
        self.assertEqual(4, piece['sides'])
        self.assertEqual(2, len(piece['points']))
        self.assertGreaterEqual(result.coverage_percent, 80.0)
        self.assertLess(result.overfill_percent, 35.0)

    def test_cylinder_recovers_circle_sweep(self):
        result, doc, _ = self._convert_mesh(_cylinder())
        self.assertEqual(1, result.piece_count)
        piece = doc['pieces'][0]
        self.assertEqual('circle', piece['shape'])
        self.assertEqual(2, len(piece['points']))
        self.assertGreaterEqual(result.coverage_percent, 80.0)
        self.assertLess(result.overfill_percent, 35.0)

    def test_sphere_recovers_point_defined_circle(self):
        result, doc, _ = self._convert_mesh(_sphere())
        self.assertEqual(1, result.piece_count)
        piece = doc['pieces'][0]
        self.assertEqual('circle', piece['shape'])
        self.assertEqual(1, len(piece['points']))
        self.assertGreaterEqual(result.coverage_percent, 80.0)
        self.assertLess(result.overfill_percent, 35.0)


if __name__ == '__main__':
    unittest.main()
