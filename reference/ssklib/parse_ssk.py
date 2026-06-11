"""Parse .ssk text files."""

import math

import yaml

from .error import SSKError

# valid field sets

_ROOT_FIELDS   = frozenset({'version', 'pieces', 'properties'})
_PIECE_FIELDS  = frozenset({'id', 'from', 'points', 'rotation', 'size', 'shape',
                            'sides', 'mode', 'affects', 'properties'})
_POINT_FIELDS  = frozenset({'x', 'y', 'z', 'curve_in', 'curve_out', 'size',
                            'rotation', 'transition_in', 'transition_out'})
_VEC3_FIELDS   = frozenset({'x', 'y', 'z'})
_VEC2_FIELDS   = frozenset({'x', 'y'})
_SHAPES        = frozenset({'circle', 'ngon'})
_MODES         = frozenset({'add', 'subtract', 'intersect'})

# strict YAML loader

class _StrictLoader(yaml.SafeLoader):
    pass


_orig_compose = yaml.composer.Composer.compose_node

def _strict_compose(self, parent, index):
    if self.check_event(yaml.AliasEvent):
        raise SSKError("YAML aliases are not valid in .ssk")
    event = self.peek_event()
    if hasattr(event, 'anchor') and event.anchor is not None:
        raise SSKError("YAML anchors are not valid in .ssk")
    if hasattr(event, 'tag') and event.tag is not None:
        explicit = False
        if isinstance(event, yaml.ScalarEvent):
            explicit = not event.implicit[0] and not event.implicit[1]
        elif hasattr(event, 'implicit') and not event.implicit:
            explicit = True
        if explicit:
            raise SSKError("YAML explicit tags are not valid in .ssk")
    return _orig_compose(self, parent, index)

_StrictLoader.compose_node = _strict_compose

def _dup_key_mapping(loader, node):
    mapping = {}
    for key_node, val_node in node.value:
        key = loader.construct_object(key_node, deep=False)
        if key in mapping:
            raise SSKError(f"duplicate mapping key: {key!r}")
        mapping[key] = loader.construct_object(val_node, deep=True)
    return mapping

_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _dup_key_mapping)
_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_SEQUENCE_TAG,
    lambda loader, node: loader.construct_sequence(node, deep=True))

# scalar helpers

def _reject_unknown(obj: dict, valid: frozenset, ctx: str):
    extra = set(obj) - valid
    if extra:
        raise SSKError(f"{ctx}: unknown fields {extra}")


def _require_finite(val, ctx: str):
    if isinstance(val, bool):
        raise SSKError(f"{ctx}: booleans are not valid numbers")
    if not isinstance(val, (int, float)):
        raise SSKError(f"{ctx}: expected number, got {type(val).__name__}")
    if math.isnan(val) or math.isinf(val):
        raise SSKError(f"{ctx}: must be finite")


def _require_int(val, ctx: str):
    if isinstance(val, bool):
        raise SSKError(f"{ctx}: booleans are not valid integers")
    if not isinstance(val, int):
        raise SSKError(f"{ctx}: expected integer, got {type(val).__name__}")


def _require_non_neg_vec3(v: dict, ctx: str):
    for c in ('x', 'y', 'z'):
        if v[c] < 0:
            raise SSKError(f"{ctx}.{c}: must be non-negative")

# vector validation

def _check_vec3(v, ctx: str):
    if not isinstance(v, dict):
        raise SSKError(f"{ctx}: expected mapping")
    _reject_unknown(v, _VEC3_FIELDS, ctx)
    for c in ('x', 'y', 'z'):
        if c not in v:
            raise SSKError(f"{ctx}: missing '{c}'")
        _require_finite(v[c], f"{ctx}.{c}")


def _check_vec2(v, ctx: str):
    if not isinstance(v, dict):
        raise SSKError(f"{ctx}: expected mapping")
    _reject_unknown(v, _VEC2_FIELDS, ctx)
    for c in ('x', 'y'):
        if c not in v:
            raise SSKError(f"{ctx}: missing '{c}'")
        _require_finite(v[c], f"{ctx}.{c}")

# properties validation

def _check_properties(props, ctx: str = "properties"):
    if not isinstance(props, dict):
        raise SSKError(f"{ctx}: expected mapping")
    for k, v in props.items():
        if not isinstance(k, str):
            raise SSKError(f"{ctx}: keys must be strings")
        _check_prop_val(v)


def _check_prop_val(val):
    if val is None or isinstance(val, (bool, str)):
        return
    if isinstance(val, (int, float)):
        if math.isnan(val) or math.isinf(val):
            raise SSKError("property values must be finite numbers")
        return
    if isinstance(val, list):
        for item in val:
            _check_prop_val(item)
        return
    if isinstance(val, dict):
        for k, v in val.items():
            if not isinstance(k, str):
                raise SSKError("property keys must be strings")
            _check_prop_val(v)
        return
    raise SSKError(f"invalid property value type: {type(val).__name__}")

# point validation

def _check_point(pt, pid: int, idx: int):
    ctx = f"piece {pid} point {idx}"
    if not isinstance(pt, dict):
        raise SSKError(f"{ctx}: expected mapping")
    _reject_unknown(pt, _POINT_FIELDS, ctx)

    for c in ('x', 'y', 'z'):
        if c not in pt:
            raise SSKError(f"{ctx}: missing '{c}'")
        _require_finite(pt[c], f"{ctx}.{c}")

    for fld in ('curve_in', 'curve_out', 'rotation'):
        if fld in pt:
            _check_vec3(pt[fld], f"{ctx} {fld}")

    if 'size' in pt:
        _check_vec3(pt['size'], f"{ctx} size")
        _require_non_neg_vec3(pt['size'], f"{ctx} size")

    for fld in ('transition_in', 'transition_out'):
        if fld in pt:
            _check_vec2(pt[fld], f"{ctx} {fld}")
            if pt[fld]['x'] < 0.0 or pt[fld]['x'] > 1.0:
                raise SSKError(f"{ctx}: {fld}.x must be in [0, 1]")

# piece validation

def _check_piece(piece):
    if not isinstance(piece, dict):
        raise SSKError("each piece must be a mapping")
    _reject_unknown(piece, _PIECE_FIELDS, "piece")

    if 'id' not in piece:
        raise SSKError("every piece must have 'id'")
    _require_int(piece['id'], 'id')
    pid = piece['id']

    has_from = 'from' in piece
    if has_from:
        _require_int(piece['from'], 'from')
    else:
        for req in ('points', 'size', 'shape'):
            if req not in piece:
                raise SSKError(f"piece {pid}: missing required field '{req}'")

    if 'points' in piece:
        if not isinstance(piece['points'], list) or len(piece['points']) < 1:
            raise SSKError(f"piece {pid}: 'points' must be a non-empty list")
        for i, pt in enumerate(piece['points']):
            _check_point(pt, pid, i)

    if 'rotation' in piece:
        _check_vec3(piece['rotation'], f"piece {pid} rotation")

    if 'size' in piece:
        _check_vec3(piece['size'], f"piece {pid} size")
        _require_non_neg_vec3(piece['size'], f"piece {pid} size")

    if 'shape' in piece:
        if piece['shape'] not in _SHAPES:
            raise SSKError(f"piece {pid}: invalid shape {piece['shape']!r}")

    if 'sides' in piece:
        _require_int(piece['sides'], f"piece {pid} sides")
        if piece['sides'] < 3:
            raise SSKError(f"piece {pid}: sides must be >= 3")

    if 'mode' in piece:
        if piece['mode'] not in _MODES:
            raise SSKError(f"piece {pid}: invalid mode {piece['mode']!r}")

    if 'affects' in piece:
        if not isinstance(piece['affects'], list):
            raise SSKError(f"piece {pid}: 'affects' must be a list")
        seen = set()
        for aid in piece['affects']:
            _require_int(aid, f"piece {pid} affects[]")
            if aid in seen:
                raise SSKError(f"piece {pid}: duplicate id {aid} in affects")
            seen.add(aid)

    if 'properties' in piece:
        _check_properties(piece['properties'], f"piece {pid} properties")

# root validation

def _check_root(doc: dict):
    _reject_unknown(doc, _ROOT_FIELDS, "root")

    if 'pieces' not in doc:
        raise SSKError("root must contain 'pieces'")
    if not isinstance(doc['pieces'], list):
        raise SSKError("'pieces' must be a list")

    if 'version' in doc:
        v = doc['version']
        if not isinstance(v, str):
            raise SSKError("'version' must be a string")
        parts = v.split('.')
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            raise SSKError(f"invalid version format: {v!r}")
        if int(parts[0]) != 0:
            raise SSKError(f"unsupported major version: {parts[0]}")

    if 'properties' in doc:
        _check_properties(doc['properties'])

    for piece in doc['pieces']:
        _check_piece(piece)

# public API

def parse(text: str) -> dict:

    for line in text.split('\n'):
        if line.lstrip().startswith('%'):
            raise SSKError("YAML directives are not valid in .ssk")
    try:
        doc = yaml.load(text, Loader=_StrictLoader)
    except yaml.YAMLError as e:
        raise SSKError(f"invalid YAML: {e}")
    if not isinstance(doc, dict):
        raise SSKError("root must be a mapping")
    _check_root(doc)
    return doc
