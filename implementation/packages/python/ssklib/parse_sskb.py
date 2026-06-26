"""Parse .sskb binary files."""

import math
import struct

import yaml

from .error import SSKError
from .parse_ssk import _StrictLoader, _check_properties, _check_root

_MAGIC = b'SSKB'
_SHAPES = {0: 'circle', 1: 'ngon'}
_MODES  = {0: 'add', 1: 'subtract', 2: 'intersect'}

# field_mask bit positions
_B_POINTS     = 0
_B_ROTATION   = 1
_B_SIZE       = 2
_B_SHAPE      = 3
_B_SIDES      = 4
_B_MODE       = 5
_B_AFFECTS    = 6
_B_PROPERTIES = 7

_MIN_PIECE_BYTES = 11
_MIN_POINT_BYTES = 18
_ROOT_PROPERTY_LENGTH_BYTES = 4

class _Reader:
    __slots__ = ('_buf', '_pos')

    def __init__(self, data: bytes):
        self._buf = data
        self._pos = 0

    def _need(self, n: int):
        if self._pos + n > len(self._buf):
            raise SSKError("truncated sskb input")

    def remaining(self) -> int:
        return len(self._buf) - self._pos

    def require_count(self, count: int, min_item_size: int, ctx: str, *, reserved_tail: int = 0):
        if self.remaining() < reserved_tail:
            raise SSKError("truncated sskb input")
        available = self.remaining() - reserved_tail
        if count > available // min_item_size:
            raise SSKError(f"{ctx}: count {count} exceeds remaining input")

    def u8(self) -> int:
        self._need(1)
        v = self._buf[self._pos]
        self._pos += 1
        return v

    def u16(self) -> int:
        self._need(2)
        v = struct.unpack_from('<H', self._buf, self._pos)[0]
        self._pos += 2
        return v

    def u32(self) -> int:
        self._need(4)
        v = struct.unpack_from('<I', self._buf, self._pos)[0]
        self._pos += 4
        return v

    def f32(self) -> float:
        self._need(4)
        v = struct.unpack_from('<f', self._buf, self._pos)[0]
        self._pos += 4
        if math.isnan(v) or math.isinf(v):
            raise SSKError("non-finite f32 value in sskb")
        return v

    def raw(self, n: int) -> bytes:
        self._need(n)
        v = self._buf[self._pos:self._pos + n]
        self._pos += n
        return v

    def vec3(self) -> dict:
        return {'x': self.f32(), 'y': self.f32(), 'z': self.f32()}

    def vec2(self) -> dict:
        return {'x': self.f32(), 'y': self.f32()}

    def done(self) -> bool:
        return self._pos >= len(self._buf)


def _bit(mask: int, pos: int) -> bool:
    return (mask >> pos) & 1 != 0


def _read_prop_blob(r: _Reader, ctx: str, *, empty_as_none: bool = True):
    n = r.u32()
    if n == 0:
        return None if empty_as_none else {}
    raw = r.raw(n)
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as e:
        raise SSKError(f"property blob not valid UTF-8: {e}")
    try:
        props = yaml.load(text, Loader=_StrictLoader)
    except yaml.YAMLError as e:
        raise SSKError(f"{ctx}: malformed property blob: {e}")
    if not isinstance(props, dict):
        raise SSKError(f"{ctx}: property blob must be a YAML mapping")
    _check_properties(props, ctx)
    return props


def _read_point(r: _Reader) -> dict:
    pt = {}
    v = r.vec3()
    pt['x'], pt['y'], pt['z'] = v['x'], v['y'], v['z']

    if r.u8(): pt['curve_in']       = r.vec3()
    if r.u8(): pt['curve_out']      = r.vec3()
    if r.u8(): pt['size']           = r.vec3()
    if r.u8(): pt['rotation']       = r.vec3()
    if r.u8(): pt['transition_in']  = r.vec2()
    if r.u8(): pt['transition_out'] = r.vec2()
    return pt


def _read_piece(r: _Reader) -> dict:
    piece = {}
    piece['id'] = r.u32()
    has_from = r.u8()

    if has_from:
        piece['from'] = r.u32()
        fm = r.u16()
        if fm & 0xFF00:
            raise SSKError(f"piece {piece['id']}: reserved field_mask bits set")
    else:
        fm = 0xFD  # all fields except rotation are always present

    # points
    if not has_from or _bit(fm, _B_POINTS):
        n = r.u32()
        r.require_count(n, _MIN_POINT_BYTES, f"piece {piece['id']} points")
        piece['points'] = [_read_point(r) for _ in range(n)]

    # rotation
    if not has_from:
        if r.u8():
            piece['rotation'] = r.vec3()
    elif _bit(fm, _B_ROTATION):
        piece['rotation'] = r.vec3()

    # size
    if not has_from or _bit(fm, _B_SIZE):
        piece['size'] = r.vec3()

    # shape
    if not has_from or _bit(fm, _B_SHAPE):
        sv = r.u8()
        if sv not in _SHAPES:
            raise SSKError(f"piece {piece['id']}: invalid shape enum {sv}")
        piece['shape'] = _SHAPES[sv]

    # sides
    if not has_from:
        if r.u8():
            piece['sides'] = r.u32()
    elif _bit(fm, _B_SIDES):
        piece['sides'] = r.u32()

    # mode : always encoded for non-inherited; default add is omitted
    if not has_from or _bit(fm, _B_MODE):
        mv = r.u8()
        if mv not in _MODES:
            raise SSKError(f"piece {piece['id']}: invalid mode enum {mv}")
        name = _MODES[mv]
        if has_from or name != 'add':
            piece['mode'] = name

    # affects
    if not has_from:
        if r.u8():
            n = r.u32()
            r.require_count(n, 4, f"piece {piece['id']} affects")
            piece['affects'] = [r.u32() for _ in range(n)]
    elif _bit(fm, _B_AFFECTS):
        n = r.u32()
        r.require_count(n, 4, f"piece {piece['id']} affects")
        piece['affects'] = [r.u32() for _ in range(n)]

    # properties
    if not has_from or _bit(fm, _B_PROPERTIES):
        props = _read_prop_blob(
            r,
            f"piece {piece['id']} properties",
            empty_as_none=not has_from,
        )
        if props is not None:
            piece['properties'] = props

    return piece

# public API

def parse(data: bytes) -> dict:

    r = _Reader(data)

    magic = r.raw(4)
    if magic != _MAGIC:
        raise SSKError(f"bad sskb magic: expected {_MAGIC!r}, got {magic!r}")

    major, minor = r.u16(), r.u16()
    if major > 1:
        raise SSKError(f"unsupported sskb major version: {major}")

    n = r.u32()
    r.require_count(n, _MIN_PIECE_BYTES, "pieces", reserved_tail=_ROOT_PROPERTY_LENGTH_BYTES)
    pieces = [_read_piece(r) for _ in range(n)]
    root_props = _read_prop_blob(r, "root properties")

    if not r.done():
        raise SSKError("extra trailing bytes in sskb")

    doc = {'pieces': pieces}
    if root_props is not None:
        doc['properties'] = root_props
    _check_root(doc)
    return doc
