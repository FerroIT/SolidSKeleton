import copy

from .error import SSKError

_INHERITABLE = frozenset({
    'points', 'rotation', 'size', 'shape', 'sides',
    'mode', 'affects', 'properties',
})


def resolve(doc: dict, *, in_place: bool = True) -> dict:
    if not isinstance(doc, dict):
        raise SSKError("document must be a mapping")

    target = doc if in_place else copy.deepcopy(doc)
    pieces = target.get('pieces')
    if not isinstance(pieces, list):
        raise SSKError("document must contain a pieces list")

    ids = []
    for index, piece in enumerate(pieces):
        if not isinstance(piece, dict):
            raise SSKError(f"piece {index}: expected mapping")
        if 'id' not in piece:
            raise SSKError(f"piece {index}: missing id")
        pid = piece['id']
        if isinstance(pid, bool) or not isinstance(pid, int):
            raise SSKError(f"piece {index}: id must be an integer")
        ids.append(pid)

    if len(set(ids)) != len(ids):
        raise SSKError("piece ids must be unique before inheritance resolution")

    by_id = {p['id']: p for p in pieces}

    _check_inheritance_graph(by_id)

    done: set[int] = set()
    for pid in sorted(by_id):
        _do(pid, by_id, done)

    return target


def _check_inheritance_graph(by_id: dict):
    visiting: set[int] = set()
    visited: set[int] = set()

    def visit(pid: int):
        if pid in visited:
            return
        if pid in visiting:
            raise SSKError(f"circular inheritance involving piece {pid}")
        visiting.add(pid)
        piece = by_id[pid]
        if 'from' in piece:
            fid = piece['from']
            if isinstance(fid, bool) or not isinstance(fid, int):
                raise SSKError(f"piece {pid}: from must be an integer")
            if fid == pid:
                raise SSKError(f"piece {pid}: self-reference is invalid")
            if fid not in by_id:
                raise SSKError(f"piece {pid}: from references non-existent piece {fid}")
            if fid > pid:
                raise SSKError(f"piece {pid}: from must reference a lower id")
            visit(fid)
        visiting.remove(pid)
        visited.add(pid)

    for pid in sorted(by_id):
        visit(pid)


def _do(pid: int, by_id: dict, done: set):
    if pid in done:
        return
    piece = by_id[pid]
    if 'from' not in piece:
        done.add(pid)
        return
    fid = piece['from']
    if fid not in done:
        _do(fid, by_id, done)
    src = by_id[fid]
    for field in _INHERITABLE:
        if field not in piece and field in src:
            piece[field] = copy.deepcopy(src[field])
    done.add(pid)
