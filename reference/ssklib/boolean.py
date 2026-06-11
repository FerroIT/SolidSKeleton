"""CSG boolean evaluation."""

import sys

import numpy as np
import trimesh


def evaluate(pieces: list, meshes: dict) -> trimesh.Trimesh:

    active = {}
    for p in pieces:
        pid = p['id']
        if pid in meshes and meshes[pid] is not None:
            v, f = meshes[pid]
            active[pid] = trimesh.Trimesh(vertices=v, faces=f, process=False)
    if not active:
        return trimesh.Trimesh()

    mode_of = {}
    add_ids, isect_ids, sub_ids = [], [], []
    for p in pieces:
        pid = p['id']
        if pid not in active:
            continue
        m = p.get('mode', 'add')
        mode_of[pid] = m
        {'add': add_ids, 'intersect': isect_ids, 'subtract': sub_ids}[m].append(pid)


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
            union = _op(union, t, 'union')
            if union is None:
                break
        if union is not None:
            res = _op(active[pid], union, 'intersection')
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
            res = _op(contrib[cid], active[pid], 'difference')
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
        r = _op(result, contrib[cid], 'union')
        if r is not None:
            result = r
    return result


def _op(a: trimesh.Trimesh, b: trimesh.Trimesh, op: str):
    fn = {'union': trimesh.boolean.union,
          'intersection': trimesh.boolean.intersection,
          'difference': trimesh.boolean.difference}[op]
    try:
        return fn([a, b], engine='manifold')
    except Exception:
        try:
            return fn([a, b])
        except Exception:
            print(f"warning: boolean {op} failed, result may be inaccurate", file=sys.stderr)
            return trimesh.util.concatenate([a, b]) if op == 'union' else a
