# SSKB Binary Encoding Specification

Status: Current
Version: 0.4
Applies to: `.sskb`

## 1. Purpose

`.sskb` is the binary encoding of the same SolidSKeleton data represented by `.ssk`.

This document defines only binary-specific storage, layout, and parser rules.

Unless this document explicitly overrides representation, decoded `.sskb` data uses the same structure, required fields, optional fields, scalar types, enum names, list order, and property rules as `format/ssk/SPEC.md`.

Geometry meaning and validation are defined in `geometry/SPEC.md`.

Binary-specific overrides:

- the file version is stored in the header, not as a root `version` field
- `mode` is stored explicitly
- optional fields are represented by presence bytes or property blob length
- `shape` and `mode` are stored as numeric enum values

## 2. Binary Basics

All multi-byte values are little-endian.

Primitive types:

- `u8` : unsigned 8-bit integer
- `u16` : unsigned 16-bit integer
- `u32` : unsigned 32-bit integer
- `f32` : IEEE 754 32-bit floating-point number

All `f32` values must be finite. `NaN` and infinite values are invalid.

Decoded values must also satisfy `format/ssk/SPEC.md` and `geometry/SPEC.md`.

## 3. File Header

Every `.sskb` file begins with:

```text
magic      4 bytes  "SSKB"
major      u16
minor      u16
```

For this version:

```text
major = 0
minor = 4
```

Parsers must reject files with an unsupported major version.

Parsers must not reject files with an unknown minor version.

## 4. Layout

### 4.1 Root

```text
piece_count       u32
pieces            piece[piece_count]
root_properties   property_blob
```

### 4.2 Piece

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
has_affects        u8
affects_count      u32, present only if has_affects != 0
affects            u32[affects_count], present only if has_affects != 0
piece_properties   property_blob
```

### 4.3 Point

```text
position           vector3
has_curve_in       u8
curve_in           vector3, present only if has_curve_in != 0
has_curve_out      u8
curve_out          vector3, present only if has_curve_out != 0
has_size           u8
size               vector3, present only if has_size != 0
has_rotation       u8
rotation           vector3, present only if has_rotation != 0
has_transition_in  u8
transition_in      vector2, present only if has_transition_in != 0
has_transition_out u8
transition_out     vector2, present only if has_transition_out != 0
```

### 4.4 Vectors

```text
vector3 = x f32, y f32, z f32
vector2 = x f32, y f32
```

## 5. Enum Encoding

`shape` values:

```text
0 = circle
1 = ngon
```

`mode` values:

```text
0 = add
1 = subtract
2 = intersect
```

Other enum values are invalid.

## 6. Presence and Arrays

Presence byte values:

```text
0 = absent
non-zero = present
```

Writers should emit `1` for present fields. Parsers must treat any non-zero presence byte as present.

Arrays are encoded as:

```text
count      u32
items      item[count]
```

Array order must be preserved.

## 7. Properties

A property blob is encoded as:

```text
byte_length    u32
bytes          u8[byte_length]
```

An empty property blob means `properties` is absent or empty. `.sskb` does not distinguish between absent and empty `properties`.

Non-empty property bytes must be a UTF-8 YAML mapping using the same YAML restrictions as `.ssk`. A document marker is not required.

Implementations that do not interpret `properties` should preserve the raw bytes when possible.

Parsers that expose properties as structured metadata must parse the blob and reject malformed blobs. Parsers that only preserve raw property bytes may defer parsing.

## 8. Parser Requirements

A conforming `.sskb` parser must:

- verify magic bytes
- verify version compatibility
- read all multi-byte values as little-endian
- preserve `pieces` order
- preserve `points` order
- reject invalid enum values
- reject non-finite `f32` values
- reject count values that exceed remaining input length
- reject truncated input
- reject invalid presence-controlled layouts
- reject malformed property blobs if property parsing is attempted
- consume exactly the bytes required by the encoded values

Extra trailing bytes after the root property blob are invalid.

Decoded data must satisfy `format/ssk/SPEC.md` structure rules and `geometry/SPEC.md` validation rules.

## 9. File Extension

The file extension for this encoding is:

```text
.sskb
```
