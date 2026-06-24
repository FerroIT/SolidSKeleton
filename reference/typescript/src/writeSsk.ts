import { stringify } from 'yaml';
import { SSKError } from './error.js';
import { checkRoot } from './parseSsk.js';
import { resolve } from './resolve.js';
import type { SSKDocument } from './types.js';
import { validate } from './validate.js';

export function writeSsk(doc: SSKDocument, options: { validateDocument?: boolean } = {}): string {
  if (options.validateDocument !== false) preflight(doc);
  return stringify(orderedDocument(doc), {
    aliasDuplicateObjects: false,
    lineWidth: 0,
    sortMapEntries: false,
  });
}

function preflight(doc: SSKDocument): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SSKError('document must be a mapping');
  checkRoot(doc as unknown as Record<string, unknown>);
  validate(resolve(doc, { inPlace: false }));
}

function orderedDocument(doc: SSKDocument): SSKDocument {
  return {
    ...(doc.version !== undefined ? { version: doc.version } : {}),
    pieces: doc.pieces.map((piece) => ({
      id: piece.id,
      ...(piece.from !== undefined ? { from: piece.from } : {}),
      ...(piece.points !== undefined ? { points: piece.points.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
        ...(point.curve_in !== undefined ? { curve_in: point.curve_in } : {}),
        ...(point.curve_out !== undefined ? { curve_out: point.curve_out } : {}),
        ...(point.size !== undefined ? { size: point.size } : {}),
        ...(point.rotation !== undefined ? { rotation: point.rotation } : {}),
        ...(point.transition_in !== undefined ? { transition_in: point.transition_in } : {}),
        ...(point.transition_out !== undefined ? { transition_out: point.transition_out } : {}),
      })) } : {}),
      ...(piece.rotation !== undefined ? { rotation: piece.rotation } : {}),
      ...(piece.size !== undefined ? { size: piece.size } : {}),
      ...(piece.shape !== undefined ? { shape: piece.shape } : {}),
      ...(piece.sides !== undefined ? { sides: piece.sides } : {}),
      ...(piece.mode !== undefined ? { mode: piece.mode } : {}),
      ...(piece.affects !== undefined ? { affects: piece.affects } : {}),
      ...(piece.properties !== undefined ? { properties: piece.properties } : {}),
    })),
    ...(doc.properties !== undefined ? { properties: doc.properties } : {}),
  };
}