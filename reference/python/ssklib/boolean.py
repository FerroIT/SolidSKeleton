"""CSG boolean evaluation."""

import trimesh

from .error import SSKError


def evaluate(pieces: list, meshes: dict, *, strict: bool = True) -> trimesh.Trimesh:

    pieces = sorted(pieces, key=lambda piece: piece['id'])

    active = {}
    for p in pieces:
        pid = p['id']
        if pid in meshes and meshes[pid] is not None:
            v, f = meshes[pid]
            active[pid] = trimesh.Trimesh(vertices=v, faces=f, process=False)
    if not active:
        return trimesh.Trimesh()

    mode_of = {}
    add_ids = []
    for p in pieces:
        pid = p['id']
        if pid not in active:
            continue
        m = p.get('mode', 'add')
        mode_of[pid] = m
        if m == 'add':
            add_ids.append(pid)


    contrib = {pid: active[pid] for pid in add_ids}

    for p in pieces:
        pid = p['id']
        if pid not in active or mode_of.get(pid) != 'intersect':
            continue
        aff = p.get('affects')
        targets = [active[o['id']] for o in pieces
                   if o['id'] != pid and o['id'] in active
                   and mode_of.get(o['id']) in ('add', 'intersect')
                   and (aff is None or o['id'] in aff)]
        if not targets:
            continue
        union = targets[0]
        for t in targets[1:]:
            union = _op(union, t, 'union', strict=strict)
            if union is None:
                break
        if union is not None:
            res = _op(active[pid], union, 'intersection', strict=strict)
            if res is not None and len(res.faces) > 0:
                contrib[pid] = res

    if not contrib:
        return trimesh.Trimesh()


    for p in pieces:
        pid = p['id']
        if pid not in active or mode_of.get(pid) != 'subtract':
            continue
        aff = p.get('affects')
        for cid in list(contrib):
            if aff is not None and cid not in aff:
                continue
            res = _op(contrib[cid], active[pid], 'difference', strict=strict)
            if res is not None:
                if len(res.faces) > 0:
                    contrib[cid] = res
                else:
                    del contrib[cid]

    if not contrib:
        return trimesh.Trimesh()

    # union remaining
    ids = sorted(contrib)
    result = contrib[ids[0]]
    for cid in ids[1:]:
        r = _op(result, contrib[cid], 'union', strict=strict)
        if r is not None:
            result = r
    return result


def _op(a: trimesh.Trimesh, b: trimesh.Trimesh, op: str, *, strict: bool):
    fn = {'union': trimesh.boolean.union,
          'intersection': trimesh.boolean.intersection,
          'difference': trimesh.boolean.difference}[op]
    try:
        return fn([a, b], engine='manifold')
    except Exception:
        try:
            return fn([a, b])
        except Exception as second_error:
            if strict:
                raise SSKError(
                    f"boolean {op} failed with manifold and fallback engines"
                ) from second_error
            return trimesh.util.concatenate([a, b]) if op == 'union' else a
