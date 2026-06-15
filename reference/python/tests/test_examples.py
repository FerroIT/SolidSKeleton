import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = REFERENCE_ROOT.parents[1]
EXAMPLES_ROOT = REPO_ROOT / 'examples'
sys.path.insert(0, str(REFERENCE_ROOT))

from ssklib.api import document_differences, inspect_file, load, mesh_document, validate_document
from ssklib.cli import main as cli_main
from ssklib.parse_sskb import parse as parse_sskb
from ssklib.write_sskb import write as write_sskb


def example_ssk_files() -> list[Path]:
    return sorted(EXAMPLES_ROOT.rglob('*.ssk'))


class ExampleTests(unittest.TestCase):
    def test_examples_are_discovered_from_repo_examples(self):
        paths = example_ssk_files()
        self.assertGreater(len(paths), 0)
        for path in paths:
            self.assertTrue(path.is_relative_to(EXAMPLES_ROOT))

    def test_all_example_ssk_files_round_trip_through_sskb(self):
        for path in example_ssk_files():
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                source = load(path)
                decoded = parse_sskb(write_sskb(source))
                self.assertEqual([], document_differences(source, decoded))

    def test_paired_example_ssk_and_sskb_files_are_equivalent(self):
        for path in example_ssk_files():
            sibling = path.with_suffix('.sskb')
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                self.assertTrue(sibling.is_file(), f"missing {sibling}")
                differences = document_differences(load(path), load(sibling))
                self.assertEqual([], differences)


class UnifiedCliTests(unittest.TestCase):
    def test_ssk_import_alias_matches_ssklib(self):
        import ssk
        import ssklib

        self.assertEqual(ssklib.__version__, ssk.__version__)
        self.assertIs(ssklib.load, ssk.load)

    def test_validate_inspect_and_binary_convert_share_api(self):
        source = EXAMPLES_ROOT / 'primitives' / 'cube' / 'cube.ssk'
        self.assertTrue(source.is_file())

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / 'cube.sskb'

            with contextlib.redirect_stdout(io.StringIO()) as validate_stdout:
                self.assertEqual(0, cli_main(['validate', str(source)]))
            self.assertIn('VALID', validate_stdout.getvalue())

            with contextlib.redirect_stdout(io.StringIO()) as convert_stdout:
                self.assertEqual(0, cli_main(['convert', str(source), str(output)]))
            self.assertTrue(output.is_file())
            self.assertIn('bytes', convert_stdout.getvalue())

            with contextlib.redirect_stdout(io.StringIO()) as inspect_stdout:
                self.assertEqual(0, cli_main(['inspect', str(output)]))
            summary = json.loads(inspect_stdout.getvalue())
            self.assertEqual('sskb', summary['encoding'])
            self.assertEqual(inspect_file(output)['pieces'], summary['pieces'])

    def test_mesh_resolution_is_configurable(self):
        doc = validate_document(load(EXAMPLES_ROOT / 'primitives' / 'sphere' / 'sphere.ssk'))

        low_vertices, low_faces = mesh_document(doc, resolution=8)
        high_vertices, high_faces = mesh_document(doc, resolution=16)

        self.assertLess(len(low_vertices), len(high_vertices))
        self.assertLess(len(low_faces), len(high_faces))

    def test_cli_convert_accepts_resolution(self):
        source = EXAMPLES_ROOT / 'primitives' / 'sphere' / 'sphere.ssk'
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / 'sphere.glb'
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(0, cli_main(['convert', str(source), str(output), '--resolution', '8']))

            self.assertTrue(output.is_file())
            self.assertIn('tris', stdout.getvalue())

    def test_cli_rejects_invalid_resolution(self):
        source = EXAMPLES_ROOT / 'primitives' / 'sphere' / 'sphere.ssk'
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / 'sphere.glb'
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    cli_main(['convert', str(source), str(output), '--resolution', '2'])
            self.assertEqual(2, raised.exception.code)


if __name__ == '__main__':
    unittest.main()
