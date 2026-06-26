from __future__ import annotations

import json

import numpy as np

from .error import SSKError
from ._core import mesh_document_json
from .vecmath import ssk_to_gltf


def mesh_document(doc: dict, *, resolution: int) -> tuple[np.ndarray | None, np.ndarray | None]:
    payload = json.dumps({'document': _core_document(doc), 'resolution': resolution}, separators=(',', ':'))

    try:
        mesh = json.loads(mesh_document_json(payload))
    except RuntimeError as exc:
        raise SSKError(str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise SSKError(f'core returned invalid JSON: {exc}') from exc

    vertices = mesh.get('vertices') or []
    faces = mesh.get('faces') or []
    if not faces:
        return None, None

    return (
        ssk_to_gltf(np.asarray(vertices, dtype=np.float64)),
        np.asarray(faces, dtype=np.int32),
    )


def _core_document(doc: dict) -> dict:
    return {
        'pieces': [_core_piece(piece) for piece in sorted(doc['pieces'], key=lambda piece: piece['id'])],
    }


def _core_piece(piece: dict) -> dict:
    return {
        'id': piece['id'],
        'points': [_core_point(point) for point in piece['points']],
        'size': piece['size'],
        'shape': piece['shape'],
        'sides': piece.get('sides'),
        'rotation': piece.get('rotation'),
        'mode': piece.get('mode', 'add'),
        'affects': piece.get('affects'),
    }


def _core_point(point: dict) -> dict:
    return {
        'x': point['x'],
        'y': point['y'],
        'z': point['z'],
        'curve_out': point.get('curve_out'),
        'curve_in': point.get('curve_in'),
        'size': point.get('size'),
        'rotation': point.get('rotation'),
        'transition_out': point.get('transition_out'),
        'transition_in': point.get('transition_in'),
    }
