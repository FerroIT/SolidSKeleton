#!/usr/bin/env python3
"""Convert .ssk text files to .sskb binary files.

Usage:
    python ssk2sskb.py <input.ssk> [-o <output.sskb>]

The output file defaults to the input basename with .sskb extension.
Performs full validation before encoding.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ssklib.error import SSKError
from ssklib.parse_ssk import parse
from ssklib.resolve import resolve
from ssklib.validate import validate
from ssklib.write_sskb import write


def convert(input_path: str, output_path: str):
    with open(input_path, 'r', encoding='utf-8') as f:
        doc = parse(f.read())

    # validate before encoding : catch errors early
    doc_copy = _deep_copy_doc(doc)
    resolve(doc_copy)
    validate(doc_copy)

    # encode the original (pre-resolution) document to preserve from references
    data = write(doc)

    with open(output_path, 'wb') as f:
        f.write(data)

    print(f"{input_path} -> {output_path}  ({len(data)} bytes, "
          f"{len(doc['pieces'])} pieces)")


def _deep_copy_doc(doc: dict) -> dict:

    import copy
    return copy.deepcopy(doc)


def main():
    ap = argparse.ArgumentParser(prog='ssk2sskb',
                                 description='Convert .ssk to .sskb')
    ap.add_argument('input', help='input .ssk file')
    ap.add_argument('-o', '--output', help='output .sskb file path')
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"error: file not found: {args.input}", file=sys.stderr)
        sys.exit(2)

    output = args.output or os.path.splitext(args.input)[0] + '.sskb'
    try:
        convert(args.input, output)
    except SSKError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
