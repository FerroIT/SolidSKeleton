# SSKB Binary Encoding Specification

Status: Current
Version: 0.1
Applies to: `.sskb`

## 1. Purpose

`.sskb` is the binary encoding of the SolidSKeleton geometry model.

This document defines how SolidSKeleton data is represented in binary form.

Geometry meaning and validation are defined in:

```text
geometry/SPEC.md
```

## 2. Byte Order

All multi-byte values are little-endian.

## 3. Primitive Types

The following primitive types are used:

- `u8` : unsigned 8-bit integer
- `u16` : unsigned 16-bit integer
- `u32` : unsigned 32-bit integer
- `f32` : IEEE 754 32-bit floating-point number

All `f32` values must be finite. `NaN` and infinite `f32` values are invalid. See `geometry/SPEC.md` for geometry validation rules.

All integer values are unsigned. Values that map to geometry fields with stricter rules, such as contiguous piece ids or `sides >= 3`, must also satisfy the geometry specification.

## 4. File Header

Every `.sskb` file begins with:

1. magic bytes
2. major version
3. minor version

Layout:

```text
magic      4 bytes
major      u16
minor      u16
```

Magic bytes:

```text
SSKB
```

Hex:

```text
53 53 4B 42
```

For this version:

```text
major = 0
minor = 1
```

Parsers must reject files with an unsupported major version.

Parsers must not reject files with an unknown minor version.

## 5. Root Layout

After the header, the root object is encoded as:

```text
piece_count       u32
pieces            piece[piece_count]
root_properties   property_blob
```

## 6. Piece Layout

Each piece is encoded in this order:

```text
id                 u32
point_count        u32
points             point[point_count]
rotation           vector3
size               vector3
shape              u8
has_sides          u8
sides              u32, present only if has_sides != 0
mode               u8
affects_count      u32
affects            u32[affects_count]
piece_properties   property_blob
```

## 7. Point Layout

Each point is encoded in this order:

```text
position           vector3
has_bezier_in      u8
bezier_in          vector3, present only if has_bezier_in != 0
has_bezier_out     u8
bezier_out         vector3, present only if has_bezier_out != 0
```

## 8. Vector3 Layout

A vector3 is encoded as:

```text
x    f32
y    f32
z    f32
```

## 9. Enum Values

### 9.1 shape

`shape` is encoded as `u8`.

Defined values:

```text
0 = circle
1 = ngon
```

Other values are invalid.

### 9.2 mode

`mode` is encoded as `u8`.

Defined values:

```text
0 = add
1 = subtract
```

Other values are invalid.

## 10. Optional Field Encoding

Optional fields use a presence byte.

Presence byte values:

```text
0 = absent
non-zero = present
```

This applies to:

- `sides`
- `bezier_in`
- `bezier_out`

Writers should emit `1` for present optional fields. Parsers must treat any non-zero presence byte as present.

## 11. Array Encoding

Arrays are encoded as:

```text
count      u32
items      item[count]
```

Array order must be preserved.

This applies to:

- `pieces`
- `points`
- `affects`

## 12. Properties Encoding

`properties` is user-defined metadata.

In `.sskb`, properties are stored as a raw UTF-8 YAML byte blob.

A property blob is encoded as:

```text
byte_length    u32
bytes          u8[byte_length]
```

If no properties are present, `byte_length` is `0`.

The byte content, when present, must represent the same metadata mapping allowed by `.ssk`: a UTF-8 YAML mapping with string keys whose values may be scalars, sequences, or nested mappings. Anchors, aliases, tags, and directives are not permitted. Duplicate keys are invalid.

The YAML mapping is encoded without a required document marker. An empty byte blob means properties are absent or empty.

Standard behavior must not depend on `properties`.

Implementations that do not interpret `properties` should preserve the raw bytes when possible.

Parsers that expose properties as structured metadata must parse the blob as UTF-8 YAML and reject malformed blobs. Parsers that only preserve raw property bytes may defer YAML parsing.

## 13. Stored Defaults

`.sskb` stores `mode` explicitly.

Optional fields are stored through presence bytes.

If `properties` is absent or empty, its property blob length is `0`.

## 14. Parser Requirements

A conforming `.sskb` parser must:

- verify magic bytes
- verify version compatibility
- read all multi-byte values as little-endian
- preserve piece order
- preserve point order
- reject invalid enum values
- reject non-finite `f32` values
- reject count values that exceed remaining input length
- reject truncated input
- reject structurally invalid arrays
- reject invalid optional-field layouts
- reject malformed property blobs if property parsing is attempted

Parsers must consume exactly the bytes required by the encoded values. Extra trailing bytes after the root property blob are invalid.

Geometry validation is defined in `geometry/SPEC.md`.

## 15. File Extension

The file extension for this encoding is:

```text
.sskb
```