#!/usr/bin/env python3
"""Convert .ssk files to glTF 2.0 (.glb or .gltf).

Usage:
    python ssk2gltf.py <input.ssk> [-o <output.glb>] [--format glb|gltf]

Output defaults to the input basename with .glb extension.
"""

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from ssklib.error import SSKError
from ssklib.parse_ssk import parse
from ssklib.resolve import resolve
from ssklib.validate import validate
from ssklib.tessellate import tessellate
from ssklib.boolean import evaluate
from ssklib.gltf import write_glb, write_gltf
from ssklib.vecmath import ssk_to_gltf


def convert(input_path: str, output_path: str):
    with open(input_path, 'r', encoding='utf-8') as f:
        doc = parse(f.read())

    resolve(doc)
    validate(doc)

    pieces = sorted(doc['pieces'], key=lambda p: p['id'])

    meshes = {}
    for p in pieces:
        v, f = tessellate(p)
        meshes[p['id']] = (v, f) if v is not None and f is not None and len(f) > 0 else None

    result = evaluate(pieces, meshes)
    if result is None or len(result.faces) == 0:
        print(f"warning: empty result, no output written", file=sys.stderr)
        return

    result.fix_normals()
    verts = ssk_to_gltf(np.array(result.vertices, dtype=np.float64))
    faces = np.array(result.faces, dtype=np.int32)

    ext = os.path.splitext(output_path)[1].lower()
    if ext == '.gltf':
        write_gltf(verts, faces, output_path)
    else:
        write_glb(verts, faces, output_path)

    print(f"{input_path} -> {output_path}  ({len(verts)} verts, {len(faces)} tris)")


def main():
    ap = argparse.ArgumentParser(prog='ssk2gltf',
                                 description='Convert .ssk to glTF 2.0')
    ap.add_argument('input', help='input .ssk file')
    ap.add_argument('-o', '--output', help='output file path')
    ap.add_argument('--format', choices=['glb', 'gltf'], default='glb',
                    help='output format (default: glb)')
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"error: file not found: {args.input}", file=sys.stderr)
        sys.exit(2)

    output = args.output or os.path.splitext(args.input)[0] + '.' + args.format
    try:
        convert(args.input, output)
    except SSKError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
