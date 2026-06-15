"""Geometry validation."""

import math

from .error import SSKError
from .parse_ssk import _check_root

_SHAPES = frozenset({'circle', 'ngon'})
_MODES  = frozenset({'add', 'subtract', 'intersect'})


def _finite(val, ctx: str):
    if isinstance(val, bool) or not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val):
        raise SSKError(f"{ctx}: must be a finite number")


def _finite_vec3(v: dict, ctx: str):
    for c in ('x', 'y', 'z'):
        _finite(v[c], f"{ctx}.{c}")


def validate(doc: dict):

    if not isinstance(doc, dict):
        raise SSKError("document must be a mapping")
    _check_root(doc)

    pieces = doc['pieces']

    ids = [p['id'] for p in pieces]
    if len(set(ids)) != len(ids):
        raise SSKError("piece ids must be unique")
    if ids:
        if min(ids) != 0:
            raise SSKError("piece ids must start at 0")
        if max(ids) != len(ids) - 1:
            raise SSKError("piece ids must be contiguous")

    by_id = {p['id']: p for p in pieces}

    for piece in pieces:
        pid = piece['id']

        if 'from' in piece:
            fid = piece['from']
            if fid not in by_id:
                raise SSKError(f"piece {pid}: from references non-existent piece {fid}")
            if fid == pid:
                raise SSKError(f"piece {pid}: self-reference is invalid")
            if fid > pid:
                raise SSKError(f"piece {pid}: from must reference a lower id")

        if 'points' not in piece or len(piece['points']) < 1:
            raise SSKError(f"piece {pid}: must have at least one point after resolution")
        for req in ('size', 'shape'):
            if req not in piece:
                raise SSKError(f"piece {pid}: missing '{req}' after resolution")

        if 'rotation' in piece:
            _finite_vec3(piece['rotation'], f"piece {pid} rotation")

        _finite_vec3(piece['size'], f"piece {pid} size")
        for c in ('x', 'y', 'z'):
            if piece['size'][c] < 0:
                raise SSKError(f"piece {pid}: size.{c} must be non-negative")

        if piece['shape'] not in _SHAPES:
            raise SSKError(f"piece {pid}: invalid shape {piece['shape']!r}")

        if 'mode' in piece and piece['mode'] not in _MODES:
            raise SSKError(f"piece {pid}: invalid mode {piece['mode']!r}")

        if piece['shape'] == 'ngon' and 'sides' not in piece:
            raise SSKError(f"piece {pid}: ngon requires sides")
        if 'sides' in piece and piece['sides'] < 3:
            raise SSKError(f"piece {pid}: sides must be >= 3")

        if 'affects' in piece:
            seen_aff = set()
            for aid in piece['affects']:
                if aid not in by_id:
                    raise SSKError(f"piece {pid}: affects references non-existent piece {aid}")
                if aid == pid:
                    raise SSKError(f"piece {pid}: cannot affect itself")
                if aid in seen_aff:
                    raise SSKError(f"piece {pid}: duplicate id {aid} in affects")
                seen_aff.add(aid)

        pts = piece['points']
        for pi, pt in enumerate(pts):
            for c in ('x', 'y', 'z'):
                _finite(pt[c], f"piece {pid} point {pi}.{c}")
            for fld in ('curve_in', 'curve_out', 'rotation'):
                if fld in pt:
                    _finite_vec3(pt[fld], f"piece {pid} point {pi} {fld}")
            if 'size' in pt:
                _finite_vec3(pt['size'], f"piece {pid} point {pi} size")
                for c in ('x', 'y', 'z'):
                    if pt['size'][c] < 0:
                        raise SSKError(f"piece {pid} point {pi}: size.{c} must be non-negative")
            for fld in ('transition_in', 'transition_out'):
                if fld in pt:
                    _finite(pt[fld]['x'], f"piece {pid} point {pi} {fld}.x")
                    _finite(pt[fld]['y'], f"piece {pid} point {pi} {fld}.y")
                    if pt[fld]['x'] < 0.0 or pt[fld]['x'] > 1.0:
                        raise SSKError(f"piece {pid} point {pi}: {fld}.x must be in [0, 1]")

        for i in range(len(pts) - 1):
            to = pts[i].get('transition_out')
            ti = pts[i + 1].get('transition_in')
            t1x = to['x'] if to else 1 / 3
            t2x = ti['x'] if ti else 2 / 3
            if not (0.0 <= t1x <= t2x <= 1.0):
                raise SSKError(f"piece {pid}: segment {i} transition not monotone in x")
