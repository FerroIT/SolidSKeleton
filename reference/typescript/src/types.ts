export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type PropertyValue = null | boolean | number | string | PropertyValue[] | { [key: string]: PropertyValue };

export type Point = {
  x: number;
  y: number;
  z: number;
  curve_in?: Vec3;
  curve_out?: Vec3;
  size?: Vec3;
  rotation?: Vec3;
  transition_in?: Vec2;
  transition_out?: Vec2;
};

export type Piece = {
  id: number;
  from?: number;
  points?: Point[];
  rotation?: Vec3;
  size?: Vec3;
  shape?: 'circle' | 'ngon';
  sides?: number;
  mode?: 'add' | 'subtract' | 'intersect';
  affects?: number[];
  properties?: Record<string, PropertyValue>;
};

export type ResolvedPiece = Piece & {
  points: Point[];
  size: Vec3;
  shape: 'circle' | 'ngon';
};

export type SSKDocument = {
  version?: string;
  pieces: Piece[];
  properties?: Record<string, PropertyValue>;
};

export type ResolvedDocument = {
  version?: string;
  pieces: ResolvedPiece[];
  properties?: Record<string, PropertyValue>;
};

export type MeshData = {
  vertices: number[][];
  faces: number[][];
};

export type ConversionFormat = 'sskb' | 'glb' | 'gltf';

export type ConversionResult = {
  outputFormat: ConversionFormat;
  pieceCount: number;
  bytesWritten?: number;
  vertexCount?: number;
  triangleCount?: number;
  coveragePercent?: number;
  overfillPercent?: number;
  data: Uint8Array | GltfOutput;
};

export type GltfOutput = {
  json: unknown;
  bin: Uint8Array;
  binUri: string;
};
