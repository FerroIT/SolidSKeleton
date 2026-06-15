from __future__ import annotations

from dataclasses import dataclass
import copy
import math
from pathlib import Path
import struct
from typing import Any

from .error import SSKError
from .parse_ssk import parse as parse_ssk
from .parse_sskb import parse as parse_sskb
from .resolve import resolve
from .validate import validate
from .write_sskb import write as write_sskb


_SUPPORTED_INPUT_EXTENSIONS = frozenset({'.ssk', '.sskb'})
_SUPPORTED_OUTPUT_EXTENSIONS = frozenset({'.sskb', '.glb', '.gltf'})
DEFAULT_RESOLUTION = 32
_ZERO_ROTATION = {'x': 0.0, 'y': 0.0, 'z': 0.0}


@dataclass(frozen=True)
class ConversionResult:
    input_path: Path
    output_path: Path
    output_format: str
    piece_count: int
    bytes_written: int | None = None
    vertex_count: int | None = None
    triangle_count: int | None = None


def load(path: str | Path) -> dict:
    """Load a .ssk or .sskb document without resolving inheritance."""

    source = Path(path)
    extension = source.suffix.lower()
    if extension not in _SUPPORTED_INPUT_EXTENSIONS:
        raise SSKError(f"unsupported input extension: {source.suffix or '(none)'}")

    try:
        if extension == '.ssk':
            return parse_ssk(source.read_text(encoding='utf-8'))
        return parse_sskb(source.read_bytes())
    except UnicodeDecodeError as exc:
        raise SSKError(f"input is not valid UTF-8: {exc}") from exc
    except OSError as exc:
        raise SSKError(f"could not read {source}: {exc}") from exc


def validate_document(doc: dict) -> dict:
    """Resolve and validate a document, returning a resolved copy."""

    resolved = resolve(doc, in_place=False)
    validate(resolved)
    return resolved


def validate_file(path: str | Path) -> dict:
    """Load, resolve, and validate a .ssk or .sskb file."""

    return validate_document(load(path))


def convert(
    input_path: str | Path,
    output_path: str | Path,
    *,
    resolution: int = DEFAULT_RESOLUTION,
) -> ConversionResult:

    source = Path(input_path)
    target = Path(output_path)
    output_extension = target.suffix.lower()
    if output_extension not in _SUPPORTED_OUTPUT_EXTENSIONS:
        raise SSKError(f"unsupported output extension: {target.suffix or '(none)'}")

    doc = load(source)
    resolved = validate_document(doc)

    if output_extension == '.sskb':
        data = write_sskb(doc)
        _write_bytes(target, data)
        return ConversionResult(
            input_path=source,
            output_path=target,
            output_format='sskb',
            piece_count=len(resolved['pieces']),
            bytes_written=len(data),
        )

    vertices, faces = mesh_document(resolved, resolution=resolution)
    if vertices is None or faces is None or len(faces) == 0:
        raise SSKError("conversion produced empty geometry")

    _write_gltf_output(vertices, faces, target)
    return ConversionResult(
        input_path=source,
        output_path=target,
        output_format=output_extension[1:],
        piece_count=len(resolved['pieces']),
        vertex_count=len(vertices),
        triangle_count=len(faces),
    )


def inspect_file(path: str | Path) -> dict:
    """Return a compact, validated summary for a .ssk or .sskb file."""

    source = Path(path)
    doc = load(source)
    resolved = validate_document(doc)
    pieces = sorted(resolved['pieces'], key=lambda piece: piece['id'])
    modes = _counts(piece.get('mode', 'add') for piece in pieces)
    shapes = _counts(piece['shape'] for piece in pieces)
    ids = [piece['id'] for piece in pieces]

    return {
        'path': str(source),
        'encoding': source.suffix.lower().lstrip('.'),
        'version': _read_declared_version(source, doc),
        'valid': True,
        'bytes': source.stat().st_size,
        'pieces': len(pieces),
        'ids': ids,
        'inherited_pieces': sum(1 for piece in doc['pieces'] if 'from' in piece),
        'shapes': shapes,
        'modes': modes,
        'root_properties': 'properties' in doc,
    }


def canonical_document(doc: dict) -> dict:
    """Return a semantic document form suitable for fast equivalence checks."""

    resolved = validate_document(doc)
    canonical: dict[str, Any] = {
        'pieces': [_canonical_piece(piece) for piece in sorted(resolved['pieces'], key=lambda piece: piece['id'])],
    }
    if 'properties' in resolved:
        canonical['properties'] = _canonical_properties(resolved['properties'])
    return canonical


def document_differences(
    left: dict,
    right: dict,
    *,
    rel_tol: float = 1e-6,
    abs_tol: float = 1e-5,
    max_diffs: int = 20,
) -> list[str]:
    """Return semantic differences between two documents."""

    differences: list[str] = []
    _compare_values(
        canonical_document(left),
        canonical_document(right),
        '$',
        differences,
        rel_tol=rel_tol,
        abs_tol=abs_tol,
        max_diffs=max_diffs,
    )
    return differences


def documents_equivalent(left: dict, right: dict, **kwargs) -> bool:
    return not document_differences(left, right, **kwargs)


def mesh_document(doc: dict, *, resolution: int = DEFAULT_RESOLUTION):
    import numpy as np

    from .boolean import evaluate
    from .tessellate import tessellate
    from .vecmath import ssk_to_gltf

    pieces = sorted(doc['pieces'], key=lambda piece: piece['id'])
    meshes = {}
    for piece in pieces:
        vertices, faces = tessellate(piece, resolution=resolution)
        meshes[piece['id']] = (
            (vertices, faces)
            if vertices is not None and faces is not None and len(faces) > 0
            else None
        )

    result = evaluate(pieces, meshes)
    if result is None or len(result.faces) == 0:
        return None, None

    vertices = ssk_to_gltf(np.array(result.vertices, dtype=np.float64))
    faces = np.array(result.faces, dtype=np.int32)
    return vertices, faces


def _write_gltf_output(vertices, faces, path: Path):
    from .gltf import write_glb, write_gltf

    try:
        if path.suffix.lower() == '.gltf':
            write_gltf(vertices, faces, str(path))
        else:
            write_glb(vertices, faces, str(path))
    except OSError as exc:
        raise SSKError(f"could not write {path}: {exc}") from exc


def _write_bytes(path: Path, data: bytes):
    try:
        path.write_bytes(data)
    except OSError as exc:
        raise SSKError(f"could not write {path}: {exc}") from exc


def _read_declared_version(path: Path, doc: dict) -> str | None:
    if path.suffix.lower() == '.ssk':
        return doc.get('version')
    try:
        header = path.read_bytes()[:8]
    except OSError:
        return None
    if len(header) < 8 or header[:4] != b'SSKB':
        return None
    major, minor = struct.unpack('<HH', header[4:8])
    return f"{major}.{minor}"


def _counts(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _canonical_piece(piece: dict) -> dict:
    piece_rotation = _canonical_vec3(piece.get('rotation', _ZERO_ROTATION))
    canonical = {
        'id': piece['id'],
        'points': [_canonical_point(point, piece, piece_rotation) for point in piece['points']],
        'rotation': piece_rotation,
        'size': _canonical_vec3(piece['size']),
        'shape': piece['shape'],
        'mode': piece.get('mode', 'add'),
    }
    if 'sides' in piece:
        canonical['sides'] = piece['sides']
    if piece.get('mode', 'add') != 'add' and 'affects' in piece:
        canonical['affects'] = list(piece['affects'])
    if 'properties' in piece:
        canonical['properties'] = _canonical_properties(piece['properties'])
    return canonical


def _canonical_point(point: dict, piece: dict, piece_rotation: dict) -> dict:
    canonical = {
        'x': _number(point['x']),
        'y': _number(point['y']),
        'z': _number(point['z']),
        'size': _canonical_vec3(point.get('size', piece['size'])),
        'rotation': _canonical_vec3(point.get('rotation', piece_rotation)),
    }
    for field in ('curve_in', 'curve_out'):
        if field in point:
            canonical[field] = _canonical_vec3(point[field])
    for field in ('transition_in', 'transition_out'):
        if field in point:
            canonical[field] = _canonical_vec2(point[field])
    return canonical


def _canonical_vec3(vector: dict) -> dict:
    return {'x': _number(vector['x']), 'y': _number(vector['y']), 'z': _number(vector['z'])}


def _canonical_vec2(vector: dict) -> dict:
    return {'x': _number(vector['x']), 'y': _number(vector['y'])}


def _canonical_properties(value):
    if isinstance(value, dict):
        return {key: _canonical_properties(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_canonical_properties(item) for item in value]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _number(value)
    return copy.deepcopy(value)


def _number(value):
    return float(value) if isinstance(value, float) else value


def _compare_values(left, right, path: str, differences: list[str], *, rel_tol: float, abs_tol: float, max_diffs: int):
    if len(differences) >= max_diffs:
        return
    if _is_number(left) and _is_number(right):
        if not math.isclose(float(left), float(right), rel_tol=rel_tol, abs_tol=abs_tol):
            differences.append(f"{path}: {left!r} != {right!r}")
        return
    if type(left) is not type(right):
        differences.append(f"{path}: {type(left).__name__} != {type(right).__name__}")
        return
    if isinstance(left, dict):
        left_keys = set(left)
        right_keys = set(right)
        for key in sorted(left_keys - right_keys):
            if len(differences) >= max_diffs:
                return
            differences.append(f"{path}.{key}: missing on right")
        for key in sorted(right_keys - left_keys):
            if len(differences) >= max_diffs:
                return
            differences.append(f"{path}.{key}: missing on left")
        for key in sorted(left_keys & right_keys):
            _compare_values(
                left[key],
                right[key],
                f"{path}.{key}",
                differences,
                rel_tol=rel_tol,
                abs_tol=abs_tol,
                max_diffs=max_diffs,
            )
        return
    if isinstance(left, list):
        if len(left) != len(right):
            differences.append(f"{path}: length {len(left)} != {len(right)}")
            return
        for index, (left_item, right_item) in enumerate(zip(left, right)):
            _compare_values(left_item, right_item, f"{path}[{index}]", differences, rel_tol=rel_tol, abs_tol=abs_tol, max_diffs=max_diffs)
        return
    if left != right:
        differences.append(f"{path}: {left!r} != {right!r}")


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
