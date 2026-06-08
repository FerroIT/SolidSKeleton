# SolidSKeleton Geometry Specification

Status: Current
Version: 0.1

## 1. Purpose

This document defines the SolidSKeleton geometry data model.

It defines:

- document structure
- piece structure
- validation rules
- geometry semantics
- boolean behavior
- coordinate system and units

Text and binary encodings are defined separately:

```text
format/ssk/SPEC.md
format/sskb/SPEC.md
```

## 2. Document Model

A SolidSKeleton document contains:

- `pieces`
- optional `properties`

### 2.1 pieces

`pieces` is an ordered list of piece objects.

A document may contain zero or more pieces.

### 2.2 properties

`properties` is a user-defined metadata mapping.

Keys must be strings.

Values may be scalars, lists, or mappings.

Duplicate keys are invalid.

Standard behavior must not depend on `properties`.

Implementations should preserve `properties` when possible.

## 3. Piece Model

Each piece contains:

- `id`
- `points`
- `rotation`
- `size`
- `shape`
- optional `sides`
- optional `mode`
- optional `affects`
- optional `properties` mapping

## 4. Coordinate System and Units

SolidSKeleton uses:

- right-handed coordinates
- Z-up orientation
- millimeters for position, Bezier, and size values
- degrees for rotation values

World UP is positive Z.

Positive rotations follow the right-hand rule.

## 5. IDs

Each piece has an `id`.

Rules:

- ids are integers
- ids are unique within the document
- ids start at `0`
- ids are contiguous

Valid id sequence:

```text
0, 1, 2, 3
```

Invalid id sequence:

```text
0, 2, 3
```

## 6. Points

`points` is an ordered list of point objects.

Each point contains:

- `x`
- `y`
- `z`
- optional `bezier_in`
- optional `bezier_out`

Rules:

- each piece must contain at least one point
- points are ordered
- point positions are in world space
- point values must be finite numbers

## 7. Bezier Controls

`bezier_in` and `bezier_out` are optional Bezier control points.

Rules:

- Bezier control points are in world space
- first point `bezier_in` is ignored
- last point `bezier_out` is ignored

For the segment from `points[i]` to `points[i + 1]`:

- `points[i].bezier_out` is the outgoing control point
- `points[i + 1].bezier_in` is the incoming control point

The segment is interpreted as:

```text
P0 = points[i]
P1 = points[i].bezier_out, or P0 if absent
P2 = points[i + 1].bezier_in, or P3 if absent
P3 = points[i + 1]
```

If both Bezier controls are absent, the segment is linear.

### 7.1 Path Segments and Tangents

For path-defined pieces, each adjacent point pair defines one path segment.

For a linear segment, the tangent is the normalized direction from the first point to the second point.

For a Bezier segment, the tangent is the normalized first derivative of the cubic Bezier curve at the evaluated position.

If the derivative at an evaluated position has zero length, implementations must use the nearest non-zero derivative on the same segment. If no non-zero derivative exists for a segment, that segment is degenerate and contributes no generated or subtractive volume.

If a path-defined piece has no non-degenerate segments, the piece is ignored.

## 8. Piece Types

A piece is interpreted based on its point count.

### 8.1 Path-defined Piece

A piece with more than one point is path-defined.

The piece follows the ordered path through its points.

For path-defined pieces:

- the path tangent defines the local Z axis along the path
- local X and local Y form the cross-section plane
- `shape` is interpreted as a cross-section
- the cross-section is swept along the path

### 8.2 Point-defined Piece

A piece with exactly one point is point-defined.

The piece has no path length. local Z defaults to world UP.

For point-defined pieces:

- local X and local Y are perpendicular to local Z
- `shape` is interpreted as a volume form around the point
- `size` is applied around the point
- `rotation` affects the local axes

### 8.3 Caps

Path-defined pieces have a cap at each end of the path.

If `size.z` is `0`, caps are flat.

If `size.z` is non-zero, each cap is the outward half of a point-defined piece with the same shape and size, placed at that endpoint.

## 9. Local Axes and Rotation

Each piece has local axes.

The base local axes equal the world axes:

- local X = world X
- local Y = world Y
- local Z = world Z

`rotation` is specified as XYZ Euler angles in degrees, applied in X, Y, Z order.

Rotation uses extrinsic world-axis rotations. The local axes are rotated around world X, then world Y, then world Z.

Using column-vector notation, the rotation matrix is:

```text
R = Rz * Ry * Rx
```

For example, a rotation of `x: 90, y: 0, z: 0` rotates the local axes 90 degrees around world X.

Positive angles follow the right-hand rule.

For path-defined pieces, local Z additionally aligns with the path tangent direction at each point along the path.

### 9.1 Path Frame Construction

For path-defined pieces, implementations must construct a local frame along the path.

At every evaluated position, the local frame must be orthonormal and right-handed.

For a non-degenerate segment, let `T` be the normalized path tangent at the evaluated position. local Z equals `T`.

The frame is initialized at the start of the first non-degenerate segment and re-initialized whenever the transport rule below cannot be applied:

1. local Z is the normalized path tangent
2. the rotated local X axis is projected onto the plane perpendicular to local Z
3. if the projected local X has non-zero length, it becomes local X after normalization
4. otherwise, the rotated local Y axis is projected onto the plane perpendicular to local Z and used as local X after normalization
5. local Y is computed as `local Z x local X`, so that local X, local Y, and local Z form a right-handed frame

Within a non-degenerate segment, the frame is propagated by parallel transport using the minimal rotation that maps the previous local Z direction to the current local Z direction.

At a join between two non-degenerate segments, let `T_prev` be the end tangent of the previous segment and `T_next` be the start tangent of the next segment.

If `T_prev` and `T_next` are equal, the incoming frame continues unchanged.

If `T_prev` and `T_next` are not opposite, the outgoing frame is the incoming frame rotated by the minimal rotation that maps `T_prev` to `T_next`.

If `T_prev` and `T_next` are opposite, or if a required tangent cannot be determined, the frame must be re-initialized using the rules above.

Implementations may use a numeric tolerance when testing whether a projected axis or derivative has zero length, or whether two tangent directions are equal or opposite. The tolerance must be applied consistently within the same evaluation.

Rotation affects:

- the orientation of `size`
- the orientation of `ngon` sides
- the generated form orientation

## 10. Size

`size` contains:

- `x`
- `y`
- `z`

All size values are radii, measured from the piece center outward along each local axis.

Rules:

- size values must be finite numbers
- size values must be non-negative
- if two or more size values are `0`, the piece is ignored
- one zero size value is allowed

For path-defined pieces, `size.x` and `size.y` define the cross-section radii. `size.z` defines the cap depth at each end of the path. See section 8.3.

For point-defined pieces, size defines the radius of the form around the point on each local axis.

## 11. Shapes

Defined shapes:

- `circle`
- `ngon`

### 11.1 circle

For path-defined pieces, `circle` defines a smooth cross-section using `size.x` and `size.y` as radii. If `size.x` and `size.y` are equal, the cross-section is circular. If they differ, the cross-section is elliptical.

For point-defined pieces, `circle` defines an ellipsoidal form around the point using `size.x`, `size.y`, and `size.z` as radii.

### 11.2 ngon

For path-defined pieces, `ngon` defines a polygonal cross-section with `sides` sides. The polygon is regular before scaling by `size.x` and `size.y`.

For point-defined pieces, `ngon` defines a bipyramidal form using the same `sides`-sided polygon cross-section. It is regular before scaling by `size.x`, `size.y`, and `size.z`.

Rules:

- `ngon` requires `sides`
- `sides` must be greater than or equal to `3`
- `sides` has no defined upper bound

## 12. Mode

Defined modes:

- `add`
- `subtract`

If `mode` is omitted, it defaults to `add`.

### 12.1 add

`add` pieces generate material.

### 12.2 subtract

`subtract` pieces remove overlapping generated material.

Subtract pieces never modify piece definitions.

## 13. Boolean Evaluation

Pieces are evaluated in two phases.

### 13.1 Add Phase

All `add` pieces generate material.

### 13.2 Subtract Phase

After all add material has been generated, all `subtract` pieces remove overlapping generated material.

If multiple subtract pieces affect the same generated material, their removal is combined.

Subtract operations cannot create negative material. They only remove existing generated material.

## 14. Affects

`affects` limits which generated material a subtract piece may modify.

Rules:

- `affects` contains piece ids
- each affected id must reference an existing piece
- only generated material from `add` pieces can be removed
- references to ignored pieces or `subtract` pieces are valid but have no generated material to modify
- if `mode` is `add`, `affects` is ignored
- if `affects` is omitted, the piece may affect all generated material

Writers should omit `affects` from `add` pieces.

## 15. Ignored Pieces

A piece is ignored if either of the following is true:

- two or more size values are `0`
- the piece is path-defined and has no non-degenerate path segments

Ignored pieces:

- do not generate material
- do not subtract material
- remain part of the document
- keep their id
- may still be preserved during round-tripping

## 16. Validation Rules

A valid SolidSKeleton geometry document must satisfy:

- `pieces` exists
- every piece has an `id`
- ids are unique
- ids start at `0`
- ids are contiguous
- every piece has at least one point
- all point coordinates are finite numbers
- all Bezier coordinates are finite numbers
- all rotation values are finite numbers
- all size values are finite numbers
- all size values are non-negative
- `shape` is a defined shape
- `mode`, if present, is a defined mode
- `shape = ngon` has valid `sides`
- `sides >= 3`
- all `affects` ids reference existing pieces

## 17. Implementation Notes

This specification defines the geometry model and required interpretation.

It does not define exact tessellation.

Different implementations may generate different meshes for the same valid document, as long as the generated geometry follows this specification.

Future conformance profiles may define stricter tessellation requirements.