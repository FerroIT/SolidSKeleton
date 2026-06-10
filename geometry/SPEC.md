# SolidSKeleton Geometry Specification

Status: Current
Version: 0.4

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

Values may be null, booleans, finite numbers, strings, lists, or mappings.

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

The piece `properties` field follows the same rules as document `properties`.

## 4. Coordinate System and Units

SolidSKeleton uses:

- right-handed coordinates
- Z-up orientation
- millimeters for point positions, path curve controls, and size values
- degrees for rotation values
- unitless values for transition controls

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
- optional `curve_in`
- optional `curve_out`
- optional `size`
- optional `rotation`
- optional `transition_in`
- optional `transition_out`

Rules:

- each piece must contain at least one point
- points are ordered
- point positions are in world space
- point coordinates must be finite numbers
- if point `size` is omitted, the piece `size` is used at that point
- if point `rotation` is omitted, the piece `rotation` is used at that point

## 7. Path Curve Controls

`curve_in` and `curve_out` are optional path curve controls.

A path segment is represented as a cubic Bezier curve.

Rules:

- path curve controls are in world space
- first point `curve_in` is ignored
- last point `curve_out` is ignored

For the segment from `points[i]` to `points[i + 1]`:

- `points[i].curve_out` is the outgoing curve control
- `points[i + 1].curve_in` is the incoming curve control

The segment is interpreted as a cubic Bezier curve:

```text
P0 = points[i]
P1 = points[i].curve_out, or P0 if absent
P2 = points[i + 1].curve_in, or P3 if absent
P3 = points[i + 1]
```

If both path curve controls are absent, the segment is linear.

### 7.1 Path Segments and Tangents

For a path-defined piece, each adjacent point pair defines one path segment.

For a linear segment, the tangent is the normalized direction from the first point to the second point.

For a curved segment, the tangent is the normalized first derivative of the cubic Bezier curve at the evaluated position.

If the derivative at an evaluated position has zero length, implementations must use the nearest non-zero derivative on the same segment. If no non-zero derivative exists for a segment, that segment is degenerate and contributes no generated or subtractive volume.

If a path-defined piece has no non-degenerate segments, the piece is ignored.

## 8. Piece Types

A piece is interpreted based on its point count.

### 8.1 Path-defined Piece

A piece with more than one point is path-defined.

The piece follows the ordered path through its points.

For a path-defined piece:

- the path tangent defines the local Z axis along the path
- local X and local Y form the cross-section plane
- `shape` is interpreted as a cross-section
- the cross-section is swept along the path

### 8.2 Point-defined Piece

A piece with exactly one point is point-defined.

The piece has no path length. Local Z defaults to world UP.

For a point-defined piece:

- local X and local Y are perpendicular to local Z
- `shape` is interpreted as a volume form around the point

### 8.3 Caps

A path-defined piece has a cap at each end of the path.

If the effective `size.z` at an endpoint is `0`, that endpoint cap is flat.

If the effective `size.z` at an endpoint is non-zero, each cap is the half of a point-defined piece that extends away from the path interior, with the same shape, effective size, and effective rotation, placed at that endpoint.

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

For a path-defined piece, local Z aligns with the path tangent direction at each evaluated position.

### 9.1 Path Frame Construction

For a path-defined piece, implementations must construct a local frame along the path.

At every evaluated position, the local frame must be orthonormal and right-handed.

Rotated local axes in this section use the effective rotation at the evaluated position.

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

Rotation defines the orientation of the local axes, including size axes and `ngon` side orientation.

### 9.2 Point Rotation Overrides

Each point may define `rotation`.

The effective rotation at a point is the point `rotation` if present, otherwise the piece `rotation`.

For a point-defined piece, the effective rotation of the only point follows the same rule.

For a path-defined piece, the effective rotation is interpolated along each segment.

Rotation interpolation is component-wise in degrees, using the segment transition curve defined in section 10.2.

For each component, implementations must interpolate across the shortest signed angular delta modulo 360 degrees.

## 10. Size

`size` contains:

- `x`
- `y`
- `z`

All size values are radii.

For a point-defined piece, they are measured from the point origin along the local axes.

For a path-defined piece, they are measured from the path centerline along the local axes.

Rules:

- size values must be finite numbers
- size values must be non-negative
- zero size values are allowed
- a size is degenerate if 2 or more components are 0

For a path-defined piece:

- `size.x` and `size.y` define the cross-section radii
- `size.z` defines the cap depth at each end of the path

For a point-defined piece, size defines the radius of the form around the point on each local axis.

### 10.1 Point Size Overrides

Each point may define `size`.

The effective size at a point is the point `size` if present, otherwise the piece `size`.

For the segment from `points[i]` to `points[i + 1]`:

- `S0` is the effective size at `points[i]`
- `S1` is the effective size at `points[i + 1]`
- evaluated size is interpolated component-wise from `S0` to `S1`
- if the segment has no transition controls, interpolation is linear in segment position
- if the segment has transition controls, interpolation uses the progress defined in section 10.2

Negative interpolated components are clamped to `0`.

An evaluated size is degenerate if two or more of its components are `0`.

For a path-defined piece, a degenerate evaluated size contributes no generated or subtractive volume at that position.

### 10.2 Point Attribute Transitions

`transition_in` and `transition_out` are optional transition controls.

They remap interpolation progress for `size` and `rotation` on a segment.

They do not affect point position or path shape.

Each segment transition is a cubic Bezier remapping from normalized segment position to interpolation progress.

For a segment:

- `u` is normalized segment position in `[0, 1]`
- `v` is interpolation progress used for `size` and `rotation`
- if both transition controls are absent, `v = u`

Each transition control contains:

- `x` = normalized segment position
- `y` = interpolation progress

Rules:

- transition control values must be finite numbers
- transition `x` is segment position and must be in the inclusive range `[0, 1]`
- transition `y` values may be any finite number
- first point `transition_in` is ignored
- last point `transition_out` is ignored

For the segment from `points[i]` to `points[i + 1]`:

- `points[i].transition_out` is the outgoing transition control
- `points[i + 1].transition_in` is the incoming transition control
- if `points[i].transition_out` is absent, the outgoing transition control is `(1 / 3, 1 / 3)`
- if `points[i + 1].transition_in` is absent, the incoming transition control is `(2 / 3, 2 / 3)`

The segment transition curve is interpreted as a cubic Bezier curve:

```text
T0 = (0, 0)
T1 = points[i].transition_out, or (1 / 3, 1 / 3) if absent
T2 = points[i + 1].transition_in, or (2 / 3, 2 / 3) if absent
T3 = (1, 1)
```

For each segment, the transition curve must be monotone in `x`. This requires `0 <= T1.x <= T2.x <= 1`.

For a given `u`, solve the transition curve for the unique point where `x = u`. That point's `y` value is `v`.

The same segment transition curve applies to both `size` and `rotation` on that segment.

Because transition `y` is not clamped, `v` may be outside the range `[0, 1]`.

This can overshoot the endpoint values. For `size`, negative interpolated components are clamped as defined in section 10.1.

## 11. Shapes

Defined shapes:

- `circle`
- `ngon`

### 11.1 circle

For a path-defined piece, `circle` defines a smooth cross-section using `size.x` and `size.y` as radii. If `size.x` and `size.y` are equal, the cross-section is circular. If they differ, the cross-section is elliptical.

For a point-defined piece, `circle` defines an ellipsoidal form around the point using `size.x`, `size.y`, and `size.z` as radii.

### 11.2 ngon

For a path-defined piece, `ngon` defines a regular polygon cross-section with `sides` sides before scaling by `size.x` and `size.y`.

For a point-defined piece, `ngon` defines a bipyramidal form using a regular polygon cross-section with `sides` sides before scaling by `size.x`, `size.y`, and `size.z`.

Rules:

- `ngon` requires `sides`
- `sides` must be greater than or equal to `3`
- `sides` has no defined upper bound

## 12. Mode

Defined modes:

- `add`
- `subtract`
- `intersect`

If `mode` is omitted, it defaults to `add`.

### 12.1 add

An `add` piece generates material.

### 12.2 subtract

A `subtract` piece removes overlapping generated material.

A `subtract` piece never modifies piece definitions.

### 12.3 intersect

An `intersect` piece contributes only the parts of its candidate volume that overlap candidate volume from another non-ignored `add` or `intersect` piece allowed by `affects`.

Non-overlapping parts are ignored.

An `intersect` piece never removes generated material.

If `affects` is present, it limits which other pieces an `intersect` piece may overlap.

## 13. Boolean Evaluation

Pieces are evaluated in two phases.

### 13.1 Add Phase

The add phase determines generated material from all `add` and `intersect` pieces.

Candidate volume is a piece volume before boolean operations.

Each `add` piece contributes its full non-ignored volume.

Each `intersect` piece contributes the volume defined in section 12.3.

### 13.2 Subtract Phase

After all add material has been generated, each `subtract` piece removes overlapping generated material.

If multiple `subtract` pieces affect the same generated material, their removal is combined.

Subtract operations only remove generated material.

## 14. Affects

`affects` limits which other pieces a piece may use as boolean input.

For a `subtract` piece, `affects` limits which generated material may be removed.

For an `intersect` piece, `affects` limits which candidate volume may be overlapped.

Rules:

- `affects` contains piece ids
- each affected id must reference an existing piece
- a piece cannot use itself as boolean input
- only material from another non-ignored piece with mode `add` or `intersect` can be used
- a reference to an ignored piece or a `subtract` piece is valid but provides no boolean input
- if `mode` is `add`, `affects` is ignored
- if `affects` is omitted, the piece may use all other pieces as boolean input
- `affects` must not contain duplicate ids

Writers should omit `affects` from an `add` piece.

## 15. Ignored Pieces

A piece is ignored if any of the following is true:

- the piece is point-defined and its effective size is degenerate
- the piece is path-defined and has no non-degenerate path segments
- the piece is path-defined and every non-degenerate path segment has degenerate evaluated size throughout

Ignored pieces:

- do not generate material
- do not subtract material
- remain part of the document
- keep their id
- may still be preserved during round-tripping

## 16. Validation Rules

A valid SolidSKeleton geometry document must satisfy:

- the document contains a `pieces` field
- every piece has an `id`
- ids are unique
- ids start at `0`
- ids are contiguous
- every piece has at least one point
- all point coordinates are finite numbers
- all path curve control coordinates are finite numbers
- all point size values are finite numbers
- all point size values are non-negative
- all rotation values are finite numbers
- all point rotation values are finite numbers
- all size values are finite numbers
- all size values are non-negative
- all transition control values are finite numbers
- all transition `x` values are in the inclusive range `[0, 1]`
- each segment transition curve is monotone in `x`
- `shape` is a defined shape
- `mode`, if present, is a defined mode
- an `ngon` piece defines `sides`
- `sides`, if present, is greater than or equal to `3`
- all `affects` ids reference existing pieces

## 17. Implementation Notes

This specification defines the geometry model and required interpretation.

It does not define exact tessellation.

Different implementations may generate different meshes for the same valid document, as long as the generated geometry follows this specification.

Future conformance profiles may define stricter tessellation requirements.