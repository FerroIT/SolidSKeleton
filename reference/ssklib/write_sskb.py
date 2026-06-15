"""Write .sskb binary files."""

import copy
import math
import struct

import yaml

from .error import SSKError
from .parse_ssk import _check_root
from .resolve import resolve
from .validate import validate

_MAGIC = b'SSKB'
_DEFAULT_VERSION = (0, 8)
_U8_MAX = 0xFF
_U16_MAX = 0xFFFF
_U32_MAX = 0xFFFFFFFF
_SHAPE_ENUM = {'circle': 0, 'ngon': 1}
_MODE_ENUM  = {'add': 0, 'subtract': 1, 'intersect': 2}

# field_mask bit positions
_B_POINTS     = 0
_B_ROTATION   = 1
_B_SIZE       = 2
_B_SHAPE      = 3
_B_SIDES      = 4
_B_MODE       = 5
_B_AFFECTS    = 6
_B_PROPERTIES = 7


class _NoAliasSafeDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


class _Writer:
    __slots__ = ('_parts',)

    def __init__(self):
        self._parts: list[bytes] = []

    def u8(self, v: int):
        _require_uint(v, _U8_MAX, 'u8')
        self._parts.append(struct.pack('<B', v))

    def u16(self, v: int):
        _require_uint(v, _U16_MAX, 'u16')
        self._parts.append(struct.pack('<H', v))

    def u32(self, v: int):
        _require_uint(v, _U32_MAX, 'u32')
        self._parts.append(struct.pack('<I', v))

    def f32(self, v: float):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
            raise SSKError(f"f32 value must be a finite number, got {v!r}")
        self._parts.append(struct.pack('<f', v))

    def raw(self, data: bytes):
        self._parts.append(data)

    def vec3(self, v: dict):
        self.f32(float(v['x']))
        self.f32(float(v['y']))
        self.f32(float(v['z']))

    def vec2(self, v: dict):
        self.f32(float(v['x']))
        self.f32(float(v['y']))

    def result(self) -> bytes:
        return b''.join(self._parts)


def _write_prop_blob(w: _Writer, props):

    if not props:
        w.u32(0)
        return
    text = yaml.dump(
        props,
        Dumper=_NoAliasSafeDumper,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    raw = text.encode('utf-8')
    w.u32(len(raw))
    w.raw(raw)


def _write_point(w: _Writer, pt: dict):
    w.vec3({'x': pt['x'], 'y': pt['y'], 'z': pt['z']})

    for field, writer in [
        ('curve_in',       w.vec3),
        ('curve_out',      w.vec3),
        ('size',           w.vec3),
        ('rotation',       w.vec3),
        ('transition_in',  w.vec2),
        ('transition_out', w.vec2),
    ]:
        if field in pt:
            w.u8(1)
            writer(pt[field])
        else:
            w.u8(0)


def _write_piece(w: _Writer, piece: dict):
    pid = piece['id']
    w.u32(pid)

    has_from = 'from' in piece
    w.u8(1 if has_from else 0)

    if has_from:
        w.u32(piece['from'])
        # build field_mask
        fm = 0
        if 'points'     in piece: fm |= 1 << _B_POINTS
        if 'rotation'   in piece: fm |= 1 << _B_ROTATION
        if 'size'       in piece: fm |= 1 << _B_SIZE
        if 'shape'      in piece: fm |= 1 << _B_SHAPE
        if 'sides'      in piece: fm |= 1 << _B_SIDES
        if 'mode'       in piece: fm |= 1 << _B_MODE
        if 'affects'    in piece: fm |= 1 << _B_AFFECTS
        if 'properties' in piece: fm |= 1 << _B_PROPERTIES
        w.u16(fm)

    # points
    if not has_from or 'points' in piece:
        pts = piece.get('points', [])
        w.u32(len(pts))
        for pt in pts:
            _write_point(w, pt)

    # rotation
    if not has_from:
        if 'rotation' in piece:
            w.u8(1)
            w.vec3(piece['rotation'])
        else:
            w.u8(0)
    elif 'rotation' in piece:
        w.vec3(piece['rotation'])

    # size
    if not has_from or 'size' in piece:
        w.vec3(piece['size'])

    # shape
    if not has_from or 'shape' in piece:
        shape = piece['shape']
        if shape not in _SHAPE_ENUM:
            raise SSKError(f"piece {pid}: unknown shape {shape!r}")
        w.u8(_SHAPE_ENUM[shape])

    # sides
    if not has_from:
        if 'sides' in piece:
            w.u8(1)
            w.u32(piece['sides'])
        else:
            w.u8(0)
    elif 'sides' in piece:
        w.u32(piece['sides'])

    # mode : always encoded for non-inherited pieces; default is add
    if not has_from:
        mode = piece.get('mode', 'add')
        if mode not in _MODE_ENUM:
            raise SSKError(f"piece {pid}: unknown mode {mode!r}")
        w.u8(_MODE_ENUM[mode])
    elif 'mode' in piece:
        if piece['mode'] not in _MODE_ENUM:
            raise SSKError(f"piece {pid}: unknown mode {piece['mode']!r}")
        w.u8(_MODE_ENUM[piece['mode']])

    # affects
    if not has_from:
        if 'affects' in piece:
            w.u8(1)
            aff = piece['affects']
            w.u32(len(aff))
            for a in aff:
                w.u32(a)
        else:
            w.u8(0)
    elif 'affects' in piece:
        aff = piece['affects']
        w.u32(len(aff))
        for a in aff:
            w.u32(a)

    # properties
    if not has_from or 'properties' in piece:
        _write_prop_blob(w, piece.get('properties'))


def write(doc: dict, *, validate_document: bool = True) -> bytes:

    if validate_document:
        _preflight(doc)

    w = _Writer()

    # header
    w.raw(_MAGIC)
    major, minor = _version_tuple(doc)
    w.u16(major)
    w.u16(minor)

    # pieces
    pieces = doc.get('pieces', [])
    w.u32(len(pieces))
    for piece in pieces:
        _write_piece(w, piece)

    # root properties
    _write_prop_blob(w, doc.get('properties'))

    return w.result()


def _require_uint(v: int, max_value: int, ctx: str):
    if isinstance(v, bool) or not isinstance(v, int):
        raise SSKError(f"{ctx} value must be an integer, got {type(v).__name__}")
    if v < 0 or v > max_value:
        raise SSKError(f"{ctx} value out of range: {v}")


def _version_tuple(doc: dict) -> tuple[int, int]:
    version = doc.get('version')
    if version is None:
        return _DEFAULT_VERSION
    parts = version.split('.')
    return int(parts[0]), int(parts[1])


def _preflight(doc: dict):
    if not isinstance(doc, dict):
        raise SSKError("document must be a mapping")
    _check_root(doc)

    major, minor = _version_tuple(doc)
    _require_uint(major, _U16_MAX, 'sskb major version')
    _require_uint(minor, _U16_MAX, 'sskb minor version')
    if major != _DEFAULT_VERSION[0]:
        raise SSKError(f"unsupported sskb major version: {major}")

    resolved = resolve(copy.deepcopy(doc), in_place=True)
    validate(resolved)
