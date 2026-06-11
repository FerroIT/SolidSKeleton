"""Resolve piece inheritance."""

import copy

from .error import SSKError

_INHERITABLE = frozenset({
    'points', 'rotation', 'size', 'shape', 'sides',
    'mode', 'affects', 'properties',
})


def resolve(doc: dict) -> dict:

    pieces = doc['pieces']
    by_id = {p['id']: p for p in pieces}

    # detect circular references
    for pid in by_id:
        visited = set()
        cur = pid
        while 'from' in by_id.get(cur, {}):
            if cur in visited:
                raise SSKError(f"circular inheritance involving piece {pid}")
            visited.add(cur)
            cur = by_id[cur]['from']

    # resolve in ascending id order (from always points to a lower id)
    done: set[int] = set()
    for pid in sorted(by_id):
        _do(pid, by_id, done)

    return doc


def _do(pid: int, by_id: dict, done: set):
    if pid in done:
        return
    piece = by_id[pid]
    if 'from' not in piece:
        done.add(pid)
        return
    fid = piece['from']
    if fid not in by_id:
        raise SSKError(f"piece {pid}: from references non-existent piece {fid}")
    if fid not in done:
        _do(fid, by_id, done)
    src = by_id[fid]
    for field in _INHERITABLE:
        if field not in piece and field in src:
            piece[field] = copy.deepcopy(src[field])
    done.add(pid)
