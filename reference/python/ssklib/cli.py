from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .api import (
    DEFAULT_COMPLEXITY_WEIGHT,
    DEFAULT_INFILL_WEIGHT,
    DEFAULT_OUTFILL_WEIGHT,
    DEFAULT_RESOLUTION,
    convert,
    inspect_file,
)
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
            result = convert(
                args.input,
                args.output,
                resolution=args.resolution,
                expected_piece_count=args.expected_piece_count,
                infill_weight=args.infill_weight,
                outfill_weight=args.outfill_weight,
                complexity_weight=args.complexity_weight,
            )
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
    convert_parser.add_argument(
        '--expected-piece-count', '--expected_piece_count',
        type=_expected_piece_count_arg,
        default=None,
        help='soft guide for GLTF/GLB import piece count; reconstruction quality remains primary',
    )
    convert_parser.add_argument(
        '--infill-weight', '--infill_weight',
        dest='infill_weight',
        type=_weight_arg,
        default=DEFAULT_INFILL_WEIGHT,
        help=f'GLTF/GLB import score weight for source volume coverage (default: {DEFAULT_INFILL_WEIGHT})',
    )
    convert_parser.add_argument(
        '--outfill-weight', '--outfill_weight',
        dest='outfill_weight',
        type=_weight_arg,
        default=DEFAULT_OUTFILL_WEIGHT,
        help=f'GLTF/GLB import score penalty weight for generated overfill (default: {DEFAULT_OUTFILL_WEIGHT})',
    )
    convert_parser.add_argument(
        '--complexity-weight', '--complexity_weight',
        dest='complexity_weight',
        type=_weight_arg,
        default=DEFAULT_COMPLEXITY_WEIGHT,
        help=f'GLTF/GLB import score penalty weight for reconstruction complexity (default: {DEFAULT_COMPLEXITY_WEIGHT})',
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


def _expected_piece_count_arg(value: str) -> int:
    try:
        count = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('expected piece count must be an integer') from exc
    if count < 1:
        raise argparse.ArgumentTypeError('expected piece count must be >= 1')
    return count


def _weight_arg(value: str) -> float:
    try:
        weight = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('weight must be a number') from exc
    if weight < 0:
        raise argparse.ArgumentTypeError('weight must be >= 0')
    return weight


def _print_conversion(result):
    quality = ''
    if result.coverage_percent is not None and result.overfill_percent is not None:
        quality = f", coverage {result.coverage_percent:.1f}%, overfill {result.overfill_percent:.1f}%"
    if result.bytes_written is not None:
        print(
            f"{result.input_path} -> {result.output_path}  "
            f"({result.bytes_written} bytes, {result.piece_count} pieces{quality})"
        )
        return
    print(
        f"{result.input_path} -> {result.output_path}  "
        f"({result.vertex_count} verts, {result.triangle_count} tris)"
    )


if __name__ == '__main__':
    raise SystemExit(main())
