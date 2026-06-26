from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Iterable

import numpy as np

from .api import (
    DEFAULT_COMPLEXITY_WEIGHT,
    DEFAULT_INFILL_WEIGHT,
    DEFAULT_OUTFILL_WEIGHT,
    DEFAULT_RESOLUTION,
    mesh_document,
    validate_document,
)
from .error import SSKError
from .tessellate import tessellate


@dataclass(frozen=True)
class QualityMetrics:
    coverage_percent: float
    overfill_percent: float
    score: float


@dataclass(frozen=True)
class ImportResult:
    document: dict
    coverage_percent: float
    overfill_percent: float
    score: float
    source_vertices: np.ndarray
    source_faces: np.ndarray
    expected_piece_count: int | None = None
    resolution: int = DEFAULT_RESOLUTION
    infill_weight: float = DEFAULT_INFILL_WEIGHT
    outfill_weight: float = DEFAULT_OUTFILL_WEIGHT
    complexity_weight: float = DEFAULT_COMPLEXITY_WEIGHT

    def score_document(self, document: dict) -> QualityMetrics:
        return score_document_against_mesh(
            document,
            self.source_vertices,
            self.source_faces,
            expected_piece_count=self.expected_piece_count,
            resolution=self.resolution,
            infill_weight=self.infill_weight,
            outfill_weight=self.outfill_weight,
            complexity_weight=self.complexity_weight,
        )


def import_gltf_to_ssk(
    path: str | Path,
    *,
    expected_piece_count: int | None = None,
    max_pieces: int | None = None,
    resolution: int = DEFAULT_RESOLUTION,
    infill_weight: float = DEFAULT_INFILL_WEIGHT,
    outfill_weight: float = DEFAULT_OUTFILL_WEIGHT,
    complexity_weight: float = DEFAULT_COMPLEXITY_WEIGHT,
) -> ImportResult:
    mesh = _load_mesh(path)
    source_vertices = _gltf_to_ssk(np.asarray(mesh.vertices, dtype=np.float64))
    source_faces = np.asarray(mesh.faces, dtype=np.int32)
    source_vertices, source_faces = _weld_and_remove_degenerates(source_vertices, source_faces)
    if len(source_faces) == 0:
        raise SSKError('GLTF/GLB input contains no non-degenerate triangles')

    prefer_low_overfill = outfill_weight > infill_weight
    candidates = _generate_candidate_documents(
        source_vertices,
        source_faces,
        expected_piece_count,
        max_pieces,
        prefer_low_overfill=prefer_low_overfill,
    )
    if not candidates:
        raise SSKError('GLTF/GLB import generated no SSK candidates')

    best_doc = None
    best_quality = None
    for doc in candidates:
        try:
            quality = score_document_for_selection(
                doc,
                source_vertices,
                source_faces,
                expected_piece_count=expected_piece_count,
                resolution=resolution,
                infill_weight=infill_weight,
                outfill_weight=outfill_weight,
                complexity_weight=complexity_weight,
            )
            if best_quality is None or quality.score > best_quality.score:
                best_doc = doc
                best_quality = quality
        except SSKError:
            continue
    if best_doc is None or best_quality is None:
        raise SSKError('GLTF/GLB import generated no scoreable SSK candidates')

    validate_document(best_doc)
    return ImportResult(
        document=best_doc,
        coverage_percent=best_quality.coverage_percent,
        overfill_percent=best_quality.overfill_percent,
        score=best_quality.score,
        source_vertices=source_vertices,
        source_faces=source_faces,
        expected_piece_count=expected_piece_count,
        resolution=resolution,
        infill_weight=infill_weight,
        outfill_weight=outfill_weight,
        complexity_weight=complexity_weight,
    )


def score_document_against_mesh(
    document: dict,
    source_vertices: np.ndarray,
    source_faces: np.ndarray,
    *,
    expected_piece_count: int | None = None,
    resolution: int = DEFAULT_RESOLUTION,
    infill_weight: float = DEFAULT_INFILL_WEIGHT,
    outfill_weight: float = DEFAULT_OUTFILL_WEIGHT,
    complexity_weight: float = DEFAULT_COMPLEXITY_WEIGHT,
) -> QualityMetrics:
    try:
        resolved = validate_document(document)
        gen_vertices_gltf, gen_faces = mesh_document(resolved, resolution=min(max(8, resolution), 16))
    except Exception as exc:  # noqa: BLE001 - expose as a bad candidate score
        raise SSKError(f'could not score generated SSK candidate: {exc}') from exc
    if gen_vertices_gltf is None or gen_faces is None or len(gen_faces) == 0:
        return QualityMetrics(0.0, 100.0, -10_000.0)

    gen_vertices = _gltf_to_ssk(np.asarray(gen_vertices_gltf, dtype=np.float64))
    gen_faces = np.asarray(gen_faces, dtype=np.int32)

    coverage, overfill = _sampled_coverage_overfill(
        np.asarray(source_vertices, dtype=np.float64),
        np.asarray(source_faces, dtype=np.int32),
        gen_vertices,
        gen_faces,
    )
    piece_count = len(resolved['pieces'])
    point_count = sum(len(piece.get('points', [])) for piece in resolved['pieces'])
    score = _quality_score(
        coverage,
        overfill,
        piece_count,
        point_count,
        expected_piece_count=expected_piece_count,
        infill_weight=infill_weight,
        outfill_weight=outfill_weight,
        complexity_weight=complexity_weight,
    )
    return QualityMetrics(round(coverage, 3), round(overfill, 3), float(score))


def score_document_for_selection(
    document: dict,
    source_vertices: np.ndarray,
    source_faces: np.ndarray,
    *,
    expected_piece_count: int | None = None,
    resolution: int = DEFAULT_RESOLUTION,
    infill_weight: float = DEFAULT_INFILL_WEIGHT,
    outfill_weight: float = DEFAULT_OUTFILL_WEIGHT,
    complexity_weight: float = DEFAULT_COMPLEXITY_WEIGHT,
) -> QualityMetrics:
    resolved = validate_document(document)
    contributions = _approximate_contributions(resolved, resolution=min(max(8, resolution), 16))
    if not contributions:
        return QualityMetrics(0.0, 100.0, -10_000.0)
    coverage, overfill = _sampled_coverage_overfill_from_contributions(
        np.asarray(source_vertices, dtype=np.float64),
        np.asarray(source_faces, dtype=np.int32),
        contributions,
    )
    point_count = sum(len(piece.get('points', [])) for piece in resolved['pieces'])
    score = _quality_score(
        coverage,
        overfill,
        len(resolved['pieces']),
        point_count,
        expected_piece_count=expected_piece_count,
        infill_weight=infill_weight,
        outfill_weight=outfill_weight,
        complexity_weight=complexity_weight,
    )
    return QualityMetrics(round(coverage, 3), round(overfill, 3), float(score))


def _quality_score(
    coverage: float,
    overfill: float,
    piece_count: int,
    point_count: int,
    *,
    expected_piece_count: int | None,
    infill_weight: float,
    outfill_weight: float,
    complexity_weight: float,
) -> float:
    complexity = 0.035 * piece_count + 0.006 * point_count
    coverage_score = coverage / 100.0
    containment_score = 1.0 - (overfill / 100.0)
    complexity_penalty = complexity / (1.0 + complexity)
    piece_count_term = 1.0 if expected_piece_count is not None and expected_piece_count > 0 else 0.0
    piece_count_score = 0.0 if piece_count_term == 0.0 else max(0.0, 1.0 - (abs(piece_count - expected_piece_count) / max(expected_piece_count, 1)))
    total_weight = infill_weight + outfill_weight + complexity_weight + piece_count_term
    return (
        infill_weight * coverage_score
        + outfill_weight * containment_score
        - complexity_weight * complexity_penalty
        + piece_count_score
    ) / max(total_weight, 1e-9)


def _load_mesh(path: str | Path):
    import trimesh

    source = Path(path)
    try:
        loaded = trimesh.load(str(source), force='scene', process=False)
    except Exception as exc:  # noqa: BLE001
        raise SSKError(f'could not read GLTF/GLB mesh {source}: {exc}') from exc

    geometries = []
    if hasattr(loaded, 'geometry'):
        try:
            dumped = loaded.dump(concatenate=False)
        except TypeError:
            dumped = loaded.dump()
        geometries = [m for m in dumped if getattr(m, 'vertices', None) is not None and len(m.vertices) and len(m.faces)]
    elif getattr(loaded, 'vertices', None) is not None:
        geometries = [loaded]

    if not geometries:
        raise SSKError('GLTF/GLB input contains no triangle mesh primitives')
    mesh = trimesh.util.concatenate(geometries) if len(geometries) > 1 else geometries[0].copy()
    mesh.remove_unreferenced_vertices()
    try:
        mesh.merge_vertices(digits_vertex=8)
        mesh.update_faces(mesh.unique_faces())
        mesh.update_faces(mesh.nondegenerate_faces())
        trimesh.repair.fill_holes(mesh)
    except Exception:
        pass
    return mesh


def _gltf_to_ssk(vertices: np.ndarray) -> np.ndarray:
    out = np.empty_like(vertices, dtype=np.float64)
    out[:, 0] = vertices[:, 0] * 1000.0
    out[:, 1] = -vertices[:, 2] * 1000.0
    out[:, 2] = vertices[:, 1] * 1000.0
    return out


def _weld_and_remove_degenerates(vertices: np.ndarray, faces: np.ndarray):
    rounded = np.round(vertices, decimals=7)
    unique, inverse = np.unique(rounded, axis=0, return_inverse=True)
    remapped = inverse[faces]
    tri = unique[remapped]
    area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) * 0.5
    keep = (area > 1e-8) & (remapped[:, 0] != remapped[:, 1]) & (remapped[:, 1] != remapped[:, 2]) & (remapped[:, 2] != remapped[:, 0])
    remapped = remapped[keep]
    used = np.unique(remapped.reshape(-1))
    compact_index = np.full(len(unique), -1, dtype=np.int32)
    compact_index[used] = np.arange(len(used), dtype=np.int32)
    return unique[used], compact_index[remapped]


def _generate_candidate_documents(
    vertices: np.ndarray,
    faces: np.ndarray,
    expected_piece_count: int | None,
    max_pieces: int | None,
    *,
    prefer_low_overfill: bool = False,
) -> list[dict]:
    components = _connected_components(vertices, faces)
    guard = max_pieces or max(8, min(112, (expected_piece_count or 56) * 2))

    segmented_pieces: list[dict] = []
    detailed_pieces: list[dict] = []
    compact_pieces: list[dict] = []
    segmented_requested = False
    for comp_vertices, comp_faces in components[:guard]:
        alternatives = _component_candidate_sets(comp_vertices, comp_faces)
        if not alternatives:
            continue
        segmented = _long_axis_partition_box_pieces(comp_vertices, comp_faces)
        if segmented:
            segmented_requested = True
            _append_candidate_pieces(segmented_pieces, segmented)
        elif prefer_low_overfill:
            _append_candidate_pieces(segmented_pieces, alternatives[0])
        _append_candidate_pieces(detailed_pieces, alternatives[0])
        _append_candidate_pieces(compact_pieces, alternatives[-1])

    docs: list[dict] = []
    if len(components) == 1:
        decomposed = _axis_partition_box_pieces(vertices, faces)
        if len(decomposed) > 1:
            docs.append({'pieces': _renumber_with_inheritance(decomposed[:guard])})
    if segmented_requested and segmented_pieces and len(segmented_pieces) != len(detailed_pieces):
        docs.append({'pieces': _renumber_with_inheritance(segmented_pieces[:guard])})
    if detailed_pieces:
        docs.append({'pieces': _renumber_with_inheritance(detailed_pieces[:guard])})
    if compact_pieces and len(compact_pieces) != len(detailed_pieces):
        docs.append({'pieces': _renumber_with_inheritance(compact_pieces[:guard])})

    whole_piece = _box_piece(0, vertices.min(axis=0), vertices.max(axis=0))
    docs.append({'pieces': [whole_piece]})
    return docs


def _connected_components(vertices: np.ndarray, faces: np.ndarray):
    parent = list(range(len(faces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_vertex: dict[int, int] = {}
    for fi, face in enumerate(faces):
        for vi in face:
            vi = int(vi)
            if vi in by_vertex:
                union(fi, by_vertex[vi])
            else:
                by_vertex[vi] = fi

    groups: dict[int, list[int]] = {}
    for fi in range(len(faces)):
        groups.setdefault(find(fi), []).append(fi)

    comps = []
    for face_indices in groups.values():
        comp_faces_raw = faces[np.asarray(face_indices, dtype=np.int32)]
        used = np.unique(comp_faces_raw.reshape(-1))
        remap = {int(v): i for i, v in enumerate(used)}
        comp_faces = np.array([[remap[int(v)] for v in face] for face in comp_faces_raw], dtype=np.int32)
        comps.append((vertices[used], comp_faces))
    comps.sort(key=lambda c: _bbox_volume(c[0].min(axis=0), c[0].max(axis=0)), reverse=True)
    return comps


def _axis_partition_box_pieces(vertices: np.ndarray, faces: np.ndarray) -> list[dict]:
    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    ext = maxs - mins
    long_axis = int(np.argmax(ext))
    split_axis = int(np.argmax([ext[i] if i != long_axis else -1.0 for i in range(3)]))
    coords = np.unique(np.round(vertices[:, split_axis], 4))
    if len(coords) < 6:
        return []
    gaps = np.diff(coords)
    positive = gaps[gaps > max(float(ext[split_axis]) * 1e-4, 1e-6)]
    if len(positive) < 2:
        return []
    small = float(np.percentile(positive, 35))
    cut_indices = [i for i, gap in enumerate(gaps) if gap > small * 2.5]
    if len(cut_indices) < 1:
        return []
    ranges: list[tuple[float, float]] = []
    start = float(coords[0])
    for index in cut_indices:
        ranges.append((start, float(coords[index])))
        start = float(coords[index + 1])
    ranges.append((start, float(coords[-1])))
    ranges = [r for r in ranges if r[1] - r[0] > 1e-6]
    if len(ranges) <= 1 or len(ranges) > 32:
        return []

    pieces: list[dict] = []
    for lo, hi in ranges:
        mask = (vertices[:, split_axis] >= lo - 1e-5) & (vertices[:, split_axis] <= hi + 1e-5)
        if int(mask.sum()) < 4:
            continue
        sub_mins = vertices[mask].min(axis=0)
        sub_maxs = vertices[mask].max(axis=0)
        if np.any(sub_maxs - sub_mins <= 1e-7):
            continue
        _append_candidate_pieces(pieces, _cuboid_shell_box_pieces(sub_mins, sub_maxs) or [_box_piece(0, sub_mins, sub_maxs)])
    return pieces if len(pieces) > 1 else []


def _long_axis_partition_box_pieces(vertices: np.ndarray, faces: np.ndarray) -> list[dict]:
    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    ext = maxs - mins
    long_axis = int(np.argmax(ext))
    cross = max(float(ext[axis]) for axis in range(3) if axis != long_axis)
    if cross <= 1e-7 or float(ext[long_axis]) / cross < 3.0 or len(vertices) < 12:
        return []

    segment_count = max(2, min(12, int(math.ceil(float(ext[long_axis]) / max(cross * 2.5, 1e-6)))))
    edges = np.linspace(float(mins[long_axis]), float(maxs[long_axis]), segment_count + 1)
    pieces: list[dict] = []
    volume = 0.0
    for index in range(segment_count):
        lo = edges[index]
        hi = edges[index + 1]
        mask = (vertices[:, long_axis] >= lo - 1e-5) & (vertices[:, long_axis] <= hi + 1e-5)
        if int(mask.sum()) < 4:
            continue
        sub_mins = vertices[mask].min(axis=0)
        sub_maxs = vertices[mask].max(axis=0)
        if np.any(sub_maxs - sub_mins <= 1e-7):
            continue
        volume += _bbox_volume(sub_mins, sub_maxs)
        _append_candidate_pieces(pieces, _cuboid_shell_box_pieces(sub_mins, sub_maxs) or [_box_piece(0, sub_mins, sub_maxs)])

    whole_volume = _bbox_volume(mins, maxs)
    if len(pieces) <= 1 or whole_volume <= 0.0 or volume >= whole_volume * 0.92:
        return []
    return pieces


def _component_candidates(vertices: np.ndarray, faces: np.ndarray) -> list[dict]:
    alternatives = _component_candidate_sets(vertices, faces)
    return alternatives[0] if alternatives else []


def _component_candidate_sets(vertices: np.ndarray, faces: np.ndarray) -> list[list[dict]]:
    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    ext = maxs - mins
    if np.any(ext <= 1e-7):
        return []

    face_count = len(faces)
    if _looks_like_torus(ext, vertices, faces):
        return [[_ring_piece(0, mins, maxs)]]
    if _looks_like_sphere(ext, face_count):
        return [[_sphere_piece(0, mins, maxs)]]
    if _looks_like_cylinder(ext, face_count):
        return [[_cylinder_piece(0, mins, maxs)]]

    simple = [_box_piece(0, mins, maxs)]
    cuboid_shell = _cuboid_shell_box_pieces(mins, maxs)
    if cuboid_shell:
        return [cuboid_shell, simple]
    return [simple]


def _append_candidate_pieces(target: list[dict], pieces: list[dict]) -> None:
    offset = len(target)
    id_map = {int(piece.get('id', index)): offset + index for index, piece in enumerate(pieces)}
    for index, piece in enumerate(pieces):
        copied = {key: _copy_value(value) for key, value in piece.items()}
        copied['id'] = offset + index
        if 'affects' in copied:
            copied['affects'] = [id_map.get(int(affected), int(affected)) for affected in copied['affects']]
        target.append(copied)


def _copy_value(value):
    if isinstance(value, dict):
        return {key: _copy_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_value(item) for item in value]
    return value


def _looks_like_sphere(ext: np.ndarray, face_count: int) -> bool:
    return face_count > 40 and float(ext.max() / ext.min()) < 1.18


def _looks_like_cylinder(ext: np.ndarray, face_count: int) -> bool:
    if face_count <= 20:
        return False
    order = np.sort(ext)
    return order[2] > order[1] * 1.35 and order[1] / order[0] < 1.18


def _looks_like_torus(ext: np.ndarray, vertices: np.ndarray, faces: np.ndarray) -> bool:
    order = np.sort(ext)
    if not (order[2] / order[1] < 1.25 and order[0] < order[2] * 0.45 and len(faces) > 100):
        return False
    center = (vertices.min(axis=0) + vertices.max(axis=0)) * 0.5
    normal_axis = int(np.argmin(ext))
    plane_axes = [axis for axis in range(3) if axis != normal_axis]
    radii = np.linalg.norm(vertices[:, plane_axes] - center[plane_axes], axis=1)
    return float(radii.max() - radii.min()) > order[0] * 0.45


def _vec(v: Iterable[float]) -> dict:
    x, y, z = [float(a) for a in v]
    return {'x': x, 'y': y, 'z': z}


def _cuboid_shell_box_pieces(mins: np.ndarray, maxs: np.ndarray) -> list[dict]:
    ext = maxs - mins
    axis = int(np.argmax(ext)) if not np.allclose(ext, ext[0]) else 2
    cross_axes = [i for i in range(3) if i != axis]
    cross_ext = ext[cross_axes]
    narrow_local = int(np.argmin(cross_ext))
    wide_local = 1 - narrow_local
    narrow_axis = cross_axes[narrow_local]
    wide_axis = cross_axes[wide_local]
    narrow = float(ext[narrow_axis])
    wide = float(ext[wide_axis])
    if narrow <= 1e-7 or wide / narrow <= 1.35:
        return []

    outer_mins = mins.copy()
    outer_maxs = maxs.copy()
    inner_mins = mins.copy()
    inner_maxs = maxs.copy()

    outer_maxs[narrow_axis] = mins[narrow_axis] + wide
    inner_mins[narrow_axis] = maxs[narrow_axis]
    inner_maxs[narrow_axis] = maxs[narrow_axis] + wide

    outer = _box_piece(0, outer_mins, outer_maxs, axis=axis)
    inner = _box_piece(1, inner_mins, inner_maxs, axis=axis)
    inner['mode'] = 'subtract'
    inner['affects'] = [0]
    return [outer, inner]


def _box_piece(pid: int, mins: np.ndarray, maxs: np.ndarray, *, axis: int | None = None) -> dict:
    center = (mins + maxs) * 0.5
    ext = maxs - mins
    if axis is None:
        axis = int(np.argmax(ext)) if not np.allclose(ext, ext[0]) else 2
    half = ext * 0.5
    radius_axes = [i for i in range(3) if i != axis]
    p0 = center.copy(); p1 = center.copy()
    p0[axis] = mins[axis]; p1[axis] = maxs[axis]
    rot = {'x': 0.0, 'y': 0.0, 'z': 0.0}
    if axis == 0:
        rot['x'] = 45.0
    elif axis == 1:
        rot['y'] = 45.0
    else:
        rot['z'] = 45.0
    sx = float(half[radius_axes[0]] * math.sqrt(2.0))
    sy = float(half[radius_axes[1]] * math.sqrt(2.0))
    return {
        'id': pid,
        'points': [_vec(p0), _vec(p1)],
        'size': {'x': sx, 'y': sy, 'z': 0.0},
        'rotation': rot,
        'shape': 'ngon',
        'sides': 4,
    }


def _cylinder_piece(pid: int, mins: np.ndarray, maxs: np.ndarray) -> dict:
    center = (mins + maxs) * 0.5
    ext = maxs - mins
    axis = int(np.argmax(ext))
    radius_axes = [i for i in range(3) if i != axis]
    p0 = center.copy(); p1 = center.copy()
    p0[axis] = mins[axis]; p1[axis] = maxs[axis]
    radius = float((ext[radius_axes[0]] + ext[radius_axes[1]]) * 0.25)
    return {
        'id': pid,
        'points': [_vec(p0), _vec(p1)],
        'size': {'x': radius, 'y': radius, 'z': 0.0},
        'shape': 'circle',
    }


def _sphere_piece(pid: int, mins: np.ndarray, maxs: np.ndarray) -> dict:
    center = (mins + maxs) * 0.5
    radius = (maxs - mins) * 0.5
    return {
        'id': pid,
        'points': [_vec(center)],
        'size': {'x': float(radius[0]), 'y': float(radius[1]), 'z': float(radius[2])},
        'shape': 'circle',
    }


def _ring_piece(pid: int, mins: np.ndarray, maxs: np.ndarray) -> dict:
    center = (mins + maxs) * 0.5
    ext = maxs - mins
    normal_axis = int(np.argmin(ext))
    axes = [axis for axis in range(3) if axis != normal_axis]
    minor = float(ext[normal_axis] * 0.5)
    major = float((ext[axes[0]] + ext[axes[1]]) * 0.25 - minor)
    major = max(major, minor * 1.5)
    k = 0.5522847498307936
    angles = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2, 2 * math.pi]
    points = []
    for i, a in enumerate(angles):
        pos = center.copy()
        pos[axes[0]] += major * math.cos(a)
        pos[axes[1]] += major * math.sin(a)
        pt = _vec(pos)
        tangent = np.zeros(3)
        tangent[axes[0]] = -math.sin(a)
        tangent[axes[1]] = math.cos(a)
        if i < len(angles) - 1:
            co = pos + k * major * tangent
            pt['curve_out'] = _vec(co)
        if i > 0:
            ci = pos - k * major * tangent
            pt['curve_in'] = _vec(ci)
        points.append(pt)
    return {
        'id': pid,
        'points': points,
        'size': {'x': minor, 'y': minor, 'z': 0.0},
        'shape': 'circle',
    }


def _renumber_with_inheritance(pieces: list[dict]) -> list[dict]:
    out: list[dict] = []
    bases: dict[tuple, int] = {}
    for piece in pieces:
        pid = len(out)
        key = _inheritance_key(piece)
        full = dict(piece)
        full['id'] = pid
        if key in bases:
            inherited = {'id': pid, 'from': bases[key], 'points': piece['points']}
            out.append(inherited)
        else:
            bases[key] = pid
            out.append(full)
    return out


def _inheritance_key(piece: dict) -> tuple:
    size = piece.get('size', {})
    rot = piece.get('rotation', {})
    return (
        piece.get('shape'),
        piece.get('sides'),
        piece.get('mode', 'add'),
        tuple(piece.get('affects', ())),
        tuple(round(float(size.get(k, 0.0)), 4) for k in ('x', 'y', 'z')),
        tuple(round(float(rot.get(k, 0.0)), 4) for k in ('x', 'y', 'z')),
    )


def _bbox_volume(mins: np.ndarray, maxs: np.ndarray) -> float:
    ext = np.maximum(maxs - mins, 0.0)
    return float(ext[0] * ext[1] * ext[2])


def _bbox_intersection_volume(a_mins: np.ndarray, a_maxs: np.ndarray, b_mins: np.ndarray, b_maxs: np.ndarray) -> float:
    ext = np.maximum(np.minimum(a_maxs, b_maxs) - np.maximum(a_mins, b_mins), 0.0)
    return float(ext[0] * ext[1] * ext[2])


def _sampled_coverage_overfill(source_vertices, source_faces, gen_vertices, gen_faces):
    mins = np.minimum(source_vertices.min(axis=0), gen_vertices.min(axis=0))
    maxs = np.maximum(source_vertices.max(axis=0), gen_vertices.max(axis=0))
    extent = maxs - mins
    pad = max(float(extent.max()) * 0.025, 1e-3)
    mins -= pad; maxs += pad
    points = _sample_points(mins, maxs, 1728)
    source_inside = _points_inside_mesh_union(points, source_vertices, source_faces)
    gen_inside = _points_inside_mesh_union(points, gen_vertices, gen_faces)

    source_count = int(source_inside.sum())
    gen_count = int(gen_inside.sum())
    if source_count == 0:
        source_mins = source_vertices.min(axis=0)
        source_maxs = source_vertices.max(axis=0)
        gen_mins = gen_vertices.min(axis=0)
        gen_maxs = gen_vertices.max(axis=0)
        source_volume = max(_bbox_volume(source_mins, source_maxs), 1e-9)
        gen_volume = max(_bbox_volume(gen_mins, gen_maxs), 1e-9)
        intersect_volume = _bbox_intersection_volume(source_mins, source_maxs, gen_mins, gen_maxs)
        coverage = min(100.0, 100.0 * intersect_volume / source_volume)
        overfill = max(0.0, 100.0 * (gen_volume - intersect_volume) / gen_volume)
        return coverage, overfill
    coverage = 0.0 if source_count == 0 else 100.0 * int((source_inside & gen_inside).sum()) / source_count
    overfill = 100.0 if gen_count == 0 else 100.0 * int((gen_inside & ~source_inside).sum()) / gen_count
    return coverage, overfill


def _sample_points(mins: np.ndarray, maxs: np.ndarray, count: int) -> np.ndarray:
    state = 12345
    random = np.empty((count, 3), dtype=np.float64)
    for index in range(count):
        for axis in range(3):
            state = (1664525 * state + 1013904223) & 0xFFFFFFFF
            random[index, axis] = state / 4294967296.0
    random = random * (maxs - mins) + mins
    grid_n = 10
    axes = [np.linspace(mins[i], maxs[i], grid_n) for i in range(3)]
    grid = np.array(np.meshgrid(*axes, indexing='ij')).reshape(3, -1).T
    return np.vstack([grid, random])


def _approximate_contributions(document: dict, resolution: int):
    contributions = {}
    for piece in document['pieces']:
        if piece.get('mode', 'add') == 'subtract':
            cutter_bounds = _square_sweep_bounds(piece)
            if cutter_bounds is None:
                continue
            targets = piece.get('affects', list(contributions.keys()))
            for target_id in targets:
                target = contributions.get(int(target_id))
                if target is None or target[2] is not True:
                    continue
                reduced = _subtract_bounds((target[0], target[1]), cutter_bounds)
                if reduced is not None:
                    contributions[int(target_id)] = (reduced[0], reduced[1], True)
            continue
        bounds = _square_sweep_bounds(piece)
        if bounds is not None:
            contributions[int(piece['id'])] = (bounds[0], bounds[1], True)
            continue
        vertices, faces = tessellate(piece, resolution=resolution)
        if vertices is not None and faces is not None and len(faces) > 0:
            contributions[int(piece['id'])] = (np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int32), False)
    return list(contributions.values())


def _sampled_coverage_overfill_from_contributions(source_vertices, source_faces, contributions):
    mins = source_vertices.min(axis=0).copy()
    maxs = source_vertices.max(axis=0).copy()
    for first, second, is_bounds in contributions:
        if is_bounds:
            mins = np.minimum(mins, first)
            maxs = np.maximum(maxs, second)
        else:
            mins = np.minimum(mins, first.min(axis=0))
            maxs = np.maximum(maxs, first.max(axis=0))
    extent = maxs - mins
    pad = max(float(extent.max()) * 0.025, 1e-3)
    mins -= pad; maxs += pad
    points = _sample_points(mins, maxs, 1728)
    source_inside = _points_inside_mesh_union(points, source_vertices, source_faces)
    gen_inside = np.zeros(len(points), dtype=bool)
    for first, second, is_bounds in contributions:
        if is_bounds:
            gen_inside |= np.all((points >= first) & (points <= second), axis=1)
        else:
            gen_inside |= _points_inside_mesh_union(points, first, second)

    source_count = int(source_inside.sum())
    gen_count = int(gen_inside.sum())
    if source_count == 0:
        source_mins = source_vertices.min(axis=0)
        source_maxs = source_vertices.max(axis=0)
        source_volume = max(_bbox_volume(source_mins, source_maxs), 1e-9)
        gen_volume = max(_bbox_volume(mins, maxs), 1e-9)
        intersect_volume = _bbox_intersection_volume(source_mins, source_maxs, mins, maxs)
        return min(100.0, 100.0 * intersect_volume / source_volume), max(0.0, 100.0 * (gen_volume - intersect_volume) / gen_volume)
    coverage = 0.0 if source_count == 0 else 100.0 * int((source_inside & gen_inside).sum()) / source_count
    overfill = 100.0 if gen_count == 0 else 100.0 * int((gen_inside & ~source_inside).sum()) / gen_count
    return coverage, overfill


def _square_sweep_bounds(piece: dict):
    if piece.get('shape') != 'ngon' or piece.get('sides') != 4 or len(piece.get('points', [])) != 2 or 'size' not in piece:
        return None
    sx = float(piece['size']['x'])
    sy = float(piece['size']['y'])
    if abs(sx - sy) > max(abs(sx), abs(sy), 1.0) * 1e-6:
        return None
    first = np.array([piece['points'][0]['x'], piece['points'][0]['y'], piece['points'][0]['z']], dtype=np.float64)
    second = np.array([piece['points'][1]['x'], piece['points'][1]['y'], piece['points'][1]['z']], dtype=np.float64)
    delta = np.abs(second - first)
    axis = int(np.argmax(delta))
    if delta[axis] <= 1e-7 or np.any(np.delete(delta, axis) > 1e-7):
        return None
    side = sx * math.sqrt(2.0)
    center = (first + second) * 0.5
    mins = center.copy()
    maxs = center.copy()
    mins[axis] = min(first[axis], second[axis])
    maxs[axis] = max(first[axis], second[axis])
    for cross_axis in range(3):
        if cross_axis == axis:
            continue
        mins[cross_axis] = center[cross_axis] - side * 0.5
        maxs[cross_axis] = center[cross_axis] + side * 0.5
    return mins, maxs


def _subtract_bounds(base, cutter):
    base_mins, base_maxs = base
    cutter_mins, cutter_maxs = cutter
    tolerance = max(float(np.max(np.abs(base_maxs - base_mins))), 1.0) * 1e-6
    for axis in range(3):
        other_axes = [index for index in range(3) if index != axis]
        if not all(cutter_mins[index] <= base_mins[index] + tolerance and cutter_maxs[index] >= base_maxs[index] - tolerance for index in other_axes):
            continue
        if cutter_mins[axis] > base_mins[axis] + tolerance and cutter_mins[axis] < base_maxs[axis] - tolerance and cutter_maxs[axis] >= base_maxs[axis] - tolerance:
            maxs = base_maxs.copy()
            maxs[axis] = cutter_mins[axis]
            return base_mins.copy(), maxs
        if cutter_maxs[axis] > base_mins[axis] + tolerance and cutter_maxs[axis] < base_maxs[axis] - tolerance and cutter_mins[axis] <= base_mins[axis] + tolerance:
            mins = base_mins.copy()
            mins[axis] = cutter_maxs[axis]
            return mins, base_maxs.copy()
    return None


def _box_mesh_from_bounds(mins: np.ndarray, maxs: np.ndarray):
    vertices = np.array([
        [mins[0], mins[1], mins[2]], [maxs[0], mins[1], mins[2]], [maxs[0], maxs[1], mins[2]], [mins[0], maxs[1], mins[2]],
        [mins[0], mins[1], maxs[2]], [maxs[0], mins[1], maxs[2]], [maxs[0], maxs[1], maxs[2]], [mins[0], maxs[1], maxs[2]],
    ], dtype=np.float64)
    faces = np.array([
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ], dtype=np.int32)
    return vertices, faces


def _points_inside_mesh_union(points: np.ndarray, vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    components = _connected_components(vertices, faces)
    if len(components) <= 1:
        return _points_inside_mesh(points, vertices, faces)
    out = np.zeros(len(points), dtype=bool)
    for comp_vertices, comp_faces in components:
        out |= _points_inside_mesh(points, comp_vertices, comp_faces)
    return out


def _points_inside_mesh(points: np.ndarray, vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    triangles = vertices[faces]
    direction = np.array([1.0, 0.3713906763541037, 0.19611613513818404], dtype=np.float64)
    direction = direction / np.linalg.norm(direction)
    out = np.zeros(len(points), dtype=bool)
    eps = 1e-9
    chunk = 256
    e1 = triangles[:, 1] - triangles[:, 0]
    e2 = triangles[:, 2] - triangles[:, 0]
    h = np.cross(np.broadcast_to(direction, e2.shape), e2)
    a = np.einsum('ij,ij->i', e1, h)
    valid_tri = np.abs(a) > eps
    inv_a = np.zeros_like(a)
    inv_a[valid_tri] = 1.0 / a[valid_tri]
    for start in range(0, len(points), chunk):
        p = points[start:start + chunk]
        counts = np.zeros(len(p), dtype=np.int32)
        for pi, point in enumerate(p):
            s = point - triangles[:, 0]
            u = inv_a * np.einsum('ij,ij->i', s, h)
            q = np.cross(s, e1)
            v = inv_a * np.einsum('j,ij->i', direction, q)
            t = inv_a * np.einsum('ij,ij->i', e2, q)
            hit = valid_tri & (u >= -eps) & (v >= -eps) & (u + v <= 1.0 + eps) & (t > eps)
            counts[pi] = int(np.count_nonzero(hit))
        out[start:start + chunk] = (counts % 2) == 1
    return out
