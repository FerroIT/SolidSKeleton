import { SSKError } from './error.js';
import { checkRoot } from './parseSsk.js';
import type { ResolvedDocument } from './types.js';

const SHAPES = new Set(['circle', 'ngon']);
const MODES = new Set(['add', 'subtract', 'intersect']);

export function validate(doc: ResolvedDocument): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SSKError('document must be a mapping');
  checkRoot(doc as unknown as Record<string, unknown>);

  const pieces = doc.pieces;
  const ids = pieces.map((piece) => piece.id);
  if (new Set(ids).size !== ids.length) throw new SSKError('piece ids must be unique');
  if (ids.length) {
    if (Math.min(...ids) !== 0) throw new SSKError('piece ids must start at 0');
    if (Math.max(...ids) !== ids.length - 1) throw new SSKError('piece ids must be contiguous');
  }

  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  for (const piece of pieces) {
    const pid = piece.id;
    if ('from' in piece) {
      const fid = piece.from!;
      if (!byId.has(fid)) throw new SSKError(`piece ${pid}: from references non-existent piece ${fid}`);
      if (fid === pid) throw new SSKError(`piece ${pid}: self-reference is invalid`);
      if (fid > pid) throw new SSKError(`piece ${pid}: from must reference a lower id`);
    }

    if (!piece.points || piece.points.length < 1) throw new SSKError(`piece ${pid}: must have at least one point after resolution`);
    for (const required of ['size', 'shape'] as const) {
      if (!(required in piece)) throw new SSKError(`piece ${pid}: missing '${required}' after resolution`);
    }

    if (piece.rotation) finiteVec3(piece.rotation, `piece ${pid} rotation`);
    finiteVec3(piece.size, `piece ${pid} size`);
    for (const coord of ['x', 'y', 'z'] as const) {
      if (piece.size[coord] < 0) throw new SSKError(`piece ${pid}: size.${coord} must be non-negative`);
    }

    if (!SHAPES.has(piece.shape)) throw new SSKError(`piece ${pid}: invalid shape ${JSON.stringify(piece.shape)}`);
    if (piece.mode && !MODES.has(piece.mode)) throw new SSKError(`piece ${pid}: invalid mode ${JSON.stringify(piece.mode)}`);
    if (piece.shape === 'ngon' && !('sides' in piece)) throw new SSKError(`piece ${pid}: ngon requires sides`);
    if (piece.sides !== undefined && piece.sides < 3) throw new SSKError(`piece ${pid}: sides must be >= 3`);

    if (piece.affects) {
      const seen = new Set<number>();
      for (const aid of piece.affects) {
        if (!byId.has(aid)) throw new SSKError(`piece ${pid}: affects references non-existent piece ${aid}`);
        if (aid === pid) throw new SSKError(`piece ${pid}: cannot affect itself`);
        if (seen.has(aid)) throw new SSKError(`piece ${pid}: duplicate id ${aid} in affects`);
        seen.add(aid);
      }
    }

    const points = piece.points;
    points.forEach((point, index) => {
      for (const coord of ['x', 'y', 'z'] as const) finite(point[coord], `piece ${pid} point ${index}.${coord}`);
      for (const field of ['curve_in', 'curve_out', 'rotation'] as const) {
        if (point[field]) finiteVec3(point[field]!, `piece ${pid} point ${index} ${field}`);
      }
      if (point.size) {
        finiteVec3(point.size, `piece ${pid} point ${index} size`);
        for (const coord of ['x', 'y', 'z'] as const) {
          if (point.size[coord] < 0) throw new SSKError(`piece ${pid} point ${index}: size.${coord} must be non-negative`);
        }
      }
      for (const field of ['transition_in', 'transition_out'] as const) {
        const transition = point[field];
        if (transition) {
          finite(transition.x, `piece ${pid} point ${index} ${field}.x`);
          finite(transition.y, `piece ${pid} point ${index} ${field}.y`);
          if (transition.x < 0 || transition.x > 1) throw new SSKError(`piece ${pid} point ${index}: ${field}.x must be in [0, 1]`);
        }
      }
    });

    for (let i = 0; i < points.length - 1; i += 1) {
      const to = points[i].transition_out;
      const ti = points[i + 1].transition_in;
      const t1x = to ? to.x : 1 / 3;
      const t2x = ti ? ti.x : 2 / 3;
      if (!(0 <= t1x && t1x <= t2x && t2x <= 1)) throw new SSKError(`piece ${pid}: segment ${i} transition not monotone in x`);
    }
  }
}

function finite(value: unknown, ctx: string): void {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SSKError(`${ctx}: must be a finite number`);
  }
}

function finiteVec3(value: { x: number; y: number; z: number }, ctx: string): void {
  finite(value.x, `${ctx}.x`);
  finite(value.y, `${ctx}.y`);
  finite(value.z, `${ctx}.z`);
}
