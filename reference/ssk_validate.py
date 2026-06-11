#!/usr/bin/env python3
"""Validate .ssk files against the JSON Schema and geometry rules.

Usage:
    python ssk_validate.py <file.ssk> [--schema <path/to/schema.json>]

Exit codes:
    0  valid
    1  invalid (details printed to stderr)
    2  usage error
"""

import argparse
import json
import os
import sys

# jsonschema is only required for schema-level validation
try:
    import jsonschema
except ImportError:
    jsonschema = None

sys.path.insert(0, os.path.dirname(__file__))
from ssklib.error import SSKError
from ssklib.parse_ssk import parse
from ssklib.resolve import resolve
from ssklib.validate import validate

_DEFAULT_SCHEMA = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'format', 'ssk', 'schema.json'))


def _load_schema(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _schema_validate(doc_raw, schema: dict) -> list[str]:
    """Run JSON Schema validation.  Returns list of error messages."""
    if jsonschema is None:
        return ["jsonschema package not installed : skipping schema validation"]
    errors = []
    validator = jsonschema.Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(doc_raw), key=lambda e: list(e.absolute_path)):
        path = '/'.join(str(p) for p in err.absolute_path) or '(root)'
        errors.append(f"  schema: {path}: {err.message}")
    return errors


def main():
    ap = argparse.ArgumentParser(
        prog='ssk_validate',
        description='Validate .ssk files against the SolidSKeleton specification.',
    )
    ap.add_argument('input', help='.ssk file to validate')
    ap.add_argument('--schema', default=None, metavar='PATH',
                    help=f'path to schema.json (default: {_DEFAULT_SCHEMA})')
    ap.add_argument('--no-schema', action='store_true',
                    help='skip JSON Schema validation, only run parser + geometry checks')
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"error: file not found: {args.input}", file=sys.stderr)
        sys.exit(2)

    with open(args.input, 'r', encoding='utf-8') as f:
        text = f.read()

    errors: list[str] = []


    if not args.no_schema:
        schema_path = args.schema or _DEFAULT_SCHEMA
        if os.path.isfile(schema_path):
            import yaml
            try:
                raw = yaml.safe_load(text)
            except yaml.YAMLError as e:
                errors.append(f"  yaml: {e}")
                raw = None
            if raw is not None:
                errors.extend(_schema_validate(raw, _load_schema(schema_path)))
        else:
            if args.schema:
                errors.append(f"  schema file not found: {schema_path}")
            else:
                print(f"note: default schema not found at {schema_path}, skipping schema validation", file=sys.stderr)


    try:
        doc = parse(text)
    except SSKError as e:
        errors.append(f"  parse: {e}")
        doc = None


    if doc is not None:
        try:
            resolve(doc)
        except SSKError as e:
            errors.append(f"  resolve: {e}")
            doc = None

    if doc is not None:
        try:
            validate(doc)
        except SSKError as e:
            errors.append(f"  geometry: {e}")


    if errors:
        print(f"INVALID  {args.input}", file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)
        sys.exit(1)
    else:
        print(f"VALID    {args.input}")
        n_pieces = len(doc['pieces']) if doc else '?'
        print(f"  pieces: {n_pieces}")
        sys.exit(0)


if __name__ == '__main__':
    main()