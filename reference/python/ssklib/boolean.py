"""CSG boolean evaluation."""

from collections import Counter
from typing import NamedTuple

import trimesh

from .error import SSKError


class _OpContext(NamedTuple):
    description: str
    left: str
    right: str


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
        targets = [(o['id'], active[o['id']]) for o in pieces
                   if o['id'] != pid and o['id'] in active
                   and mode_of.get(o['id']) in ('add', 'intersect')
                   and (aff is None or o['id'] in aff)]
        if not targets:
            continue
        union = targets[0][1]
        for target_id, t in targets[1:]:
            union = _op(
                union,
                t,
                'union',
                strict=strict,
                context=_OpContext(
                    f"intersect piece {pid} candidate union with piece {target_id}",
                    f"intersect piece {pid} candidate union",
                    f"piece {target_id}",
                ),
            )
            if union is None:
                break
        if union is not None:
            res = _op(
                active[pid],
                union,
                'intersection',
                strict=strict,
                context=_OpContext(
                    f"intersect piece {pid} with candidate union",
                    f"piece {pid}",
                    f"intersect piece {pid} candidate union",
                ),
            )
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
            res = _op(
                contrib[cid],
                active[pid],
                'difference',
                strict=strict,
                context=_OpContext(
                    f"subtract piece {pid} from piece {cid}",
                    f"piece {cid} result",
                    f"subtract piece {pid}",
                ),
            )
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
        r = _op(
            result,
            contrib[cid],
            'union',
            strict=strict,
            context=_OpContext(
                f"final union with piece {cid}",
                "current final result",
                f"piece {cid} result",
            ),
        )
        if r is not None:
            result = r
    return result


def _op(
    a: trimesh.Trimesh,
    b: trimesh.Trimesh,
    op: str,
    *,
    strict: bool,
    context: _OpContext,
):
    fn = {'union': trimesh.boolean.union,
          'intersection': trimesh.boolean.intersection,
          'difference': trimesh.boolean.difference}[op]
    try:
        return fn([a, b], engine='manifold')
    except Exception as manifold_error:
        try:
            return fn([a, b])
        except Exception as second_error:
            if strict:
                raise SSKError(_failure_message(
                    op,
                    context,
                    manifold_error,
                    second_error,
                    _mesh_report(context.left, a),
                    _mesh_report(context.right, b),
                )) from second_error
            return trimesh.util.concatenate([a, b]) if op == 'union' else a


def _failure_message(op, context, manifold_error, fallback_error, left_report, right_report):
    return (
        f"boolean {op} failed: {context.description}; "
        f"manifold={_error_text(manifold_error)}; "
        f"fallback={_error_text(fallback_error)}; "
        f"{left_report}; {right_report}"
    )


def _error_text(error: Exception) -> str:
    message = str(error).strip()
    if not message:
        message = error.__class__.__name__
    return message.replace('\n', ' ')


def _mesh_report(label: str, mesh: trimesh.Trimesh) -> str:
    boundary_edges, non_manifold_edges, degenerate_faces = _edge_diagnostics(mesh)
    parts = [
        f"{label}: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles",
        f"watertight={mesh.is_watertight}",
        f"winding_consistent={mesh.is_winding_consistent}",
        f"volume={mesh.is_volume}",
        f"degenerate_faces={degenerate_faces}",
        f"boundary_edges={boundary_edges}",
        f"non_manifold_edges={non_manifold_edges}",
    ]
    bounds = _bounds_text(mesh)
    if bounds is not None:
        parts.append(f"bounds={bounds}")
    return ', '.join(parts)


def _edge_diagnostics(mesh: trimesh.Trimesh) -> tuple[int, int, int]:
    edge_counts = Counter()
    degenerate_faces = 0
    vertex_count = len(mesh.vertices)
    for face in mesh.faces:
        face_ids = [int(index) for index in face]
        if len(set(face_ids)) < 3:
            degenerate_faces += 1
            continue
        if any(index < 0 or index >= vertex_count for index in face_ids):
            continue
        for start, end in ((0, 1), (1, 2), (2, 0)):
            a, b = face_ids[start], face_ids[end]
            edge_counts[tuple(sorted((a, b)))] += 1
    boundary_edges = sum(1 for count in edge_counts.values() if count == 1)
    non_manifold_edges = sum(1 for count in edge_counts.values() if count > 2)
    return boundary_edges, non_manifold_edges, degenerate_faces


def _bounds_text(mesh: trimesh.Trimesh) -> str | None:
    try:
        bounds = mesh.bounds
    except Exception:
        return None
    if bounds is None or len(bounds) != 2:
        return None
    return f"min={_vec_text(bounds[0])}, max={_vec_text(bounds[1])}"


def _vec_text(values) -> str:
    return '(' + ', '.join(f"{float(value):.6g}" for value in values) + ')'
