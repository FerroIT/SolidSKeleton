from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .api import DEFAULT_RESOLUTION, convert, inspect_file
from .error import SSKError


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)

    try:
        if args.command == 'validate':
            summary = inspect_file(args.input)
            print(f"VALID    {args.input}")
            print(f"  encoding: {summary['encoding']}")
            print(f"  pieces: {summary['pieces']}")
            return 0
        if args.command == 'convert':
            result = convert(args.input, args.output, resolution=args.resolution)
            _print_conversion(result)
            return 0
        if args.command == 'inspect':
            summary = inspect_file(args.input)
            print(json.dumps(summary, indent=2, sort_keys=True))
            return 0
    except SSKError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130

    parser.error(f"unknown command: {args.command}")
    return 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='ssk',
        description='Validate, convert, and inspect SolidSKeleton files.',
    )
    parser.add_argument('--version', action='version', version=f'ssk {__version__}')

    subparsers = parser.add_subparsers(dest='command', required=True)

    validate_parser = subparsers.add_parser('validate', help='validate a .ssk or .sskb file')
    validate_parser.add_argument('input', help='input .ssk or .sskb file')

    convert_parser = subparsers.add_parser('convert', help='convert between supported formats')
    convert_parser.add_argument('input', help='input .ssk or .sskb file')
    convert_parser.add_argument('output', help='output .sskb, .glb, or .gltf file')
    convert_parser.add_argument(
        '--resolution',
        type=_resolution_arg,
        default=DEFAULT_RESOLUTION,
        help=f'mesh tessellation resolution for .glb/.gltf output (default: {DEFAULT_RESOLUTION})',
    )

    inspect_parser = subparsers.add_parser('inspect', help='print a validated JSON summary')
    inspect_parser.add_argument('input', help='input .ssk or .sskb file')

    return parser


def _resolution_arg(value: str) -> int:
    try:
        resolution = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('resolution must be an integer') from exc
    if resolution < 3:
        raise argparse.ArgumentTypeError('resolution must be >= 3')
    return resolution


def _print_conversion(result):
    if result.bytes_written is not None:
        print(
            f"{result.input_path} -> {result.output_path}  "
            f"({result.bytes_written} bytes, {result.piece_count} pieces)"
        )
        return
    print(
        f"{result.input_path} -> {result.output_path}  "
        f"({result.vertex_count} verts, {result.triangle_count} tris)"
    )


if __name__ == '__main__':
    raise SystemExit(main())
