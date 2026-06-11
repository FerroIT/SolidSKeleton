"""Write .sskb binary files."""

import struct

import yaml

from .error import SSKError

_MAGIC = b'SSKB'
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


class _Writer:
    __slots__ = ('_parts',)

    def __init__(self):
        self._parts: list[bytes] = []

    def u8(self, v: int):
        self._parts.append(struct.pack('<B', v))

    def u16(self, v: int):
        self._parts.append(struct.pack('<H', v))

    def u32(self, v: int):
        self._parts.append(struct.pack('<I', v))

    def f32(self, v: float):
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
    text = yaml.dump(props, default_flow_style=False, allow_unicode=True)
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
        w.u8(_MODE_ENUM[mode])
    elif 'mode' in piece:
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


def write(doc: dict) -> bytes:

    w = _Writer()

    # header
    w.raw(_MAGIC)
    # parse version string, default to 0.7
    ver = doc.get('version', '0.7')
    parts = ver.split('.')
    w.u16(int(parts[0]))
    w.u16(int(parts[1]))

    # pieces
    pieces = doc.get('pieces', [])
    w.u32(len(pieces))
    for piece in pieces:
        _write_piece(w, piece)

    # root properties
    _write_prop_blob(w, doc.get('properties'))

    return w.result()
