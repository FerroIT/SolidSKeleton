# SSK Text Encoding Specification

Status: Current
Version: 0.1
Applies to: `.ssk`

## 1. Purpose

`.ssk` is the text encoding of the SolidSKeleton geometry model.

This document defines how SolidSKeleton data is represented as text.

Geometry meaning and validation are defined in:

```text
geometry/SPEC.md
```

## 2. Encoding

`.ssk` files are UTF-8 text files.

Rules:

- line endings may be LF or CRLF
- parsers must accept LF and CRLF
- writers should emit LF

## 3. Syntax Base

`.ssk` uses YAML syntax.

A valid `.ssk` file must be valid YAML.

YAML anchors, aliases, explicit tags, and directives are not part of the SolidSKeleton data model and are invalid.

Duplicate mapping keys are invalid.

Parsers may use standard YAML parsers, but must enforce the structure and type rules in this specification.

A JSON Schema for structural validation is provided at `format/ssk/schema.json`. It does not validate all geometry rules.

## 4. Root Object

The root object must be a mapping.

Root fields:

- `version` : optional
- `pieces` : required
- `properties` : optional mapping

Unknown root fields are invalid.

## 5. Piece Object

Each item in `pieces` must be a mapping.

Piece fields:

- `id` : required integer
- `points` : required list
- `rotation` : required vector3
- `size` : required vector3
- `shape` : required string
- `sides` : optional integer
- `mode` : optional string
- `affects` : optional list of integers
- `properties` : optional mapping

Unknown piece fields are invalid.

## 6. Point Object

Each item in `points` must be a mapping.

Point fields:

- `x` : required number
- `y` : required number
- `z` : required number
- `bezier_in` : optional vector3
- `bezier_out` : optional vector3

Unknown point fields are invalid.

## 7. Vector3 Object

A vector3 must be a mapping with:

- `x` : required number
- `y` : required number
- `z` : required number

Unknown vector3 fields are invalid.

## 8. Scalar Types

### 8.1 Numbers

Numbers may be integers or decimals.

Parsers must support signed decimal numbers.

Numbers must be finite. YAML values such as `.nan`, `.inf`, and `-.inf` are invalid for SolidSKeleton numeric fields.

Boolean values are not valid numbers, even if a YAML parser represents booleans as numeric values internally.

### 8.2 Integers

The following fields must be integers:

- `id`
- `sides`
- `affects[]`

Integer fields must not contain fractional values.

### 8.3 Strings

The following string values are defined.

For `shape`:

- `circle`
- `ngon`

For `mode`:

- `add`
- `subtract`

String values are case-sensitive.

## 9. Lists

The following fields are lists:

- `pieces`
- `points`
- `affects`

List order must be preserved.

## 10. Properties

`properties` is a user-defined metadata mapping.

`properties` may appear:

- at the root level
- on a piece

Property keys must be strings.

Property values may be scalars, sequences, or nested mappings.

Duplicate keys are invalid.

Standard behavior must not depend on `properties`.

Implementations should preserve `properties` when possible.

## 11. Optional Fields

If omitted:

- `mode` defaults to `add`
- `affects` means the piece may affect all generated material
- `properties` is treated as empty
- `bezier_in` is absent
- `bezier_out` is absent

## 12. Field Order

Writers should emit fields in a stable order.

Recommended root order:

1. `version`
2. `pieces`
3. `properties`

Recommended piece order:

1. `id`
2. `points`
3. `rotation`
4. `size`
5. `shape`
6. `sides`
7. `mode`
8. `affects`
9. `properties`

Recommended point order:

1. `x`
2. `y`
3. `z`
4. `bezier_in`
5. `bezier_out`

Recommended vector order:

1. `x`
2. `y`
3. `z`

Parsers must not require a specific field order.

## 13. Comments

YAML comments are allowed.

Writers should not rely on comments to store required data.

## 14. Parser Requirements

A conforming `.ssk` parser must:

- parse UTF-8 YAML input
- require a root mapping
- require `pieces`
- preserve piece order
- preserve point order
- reject YAML anchors, aliases, explicit tags, and directives
- reject duplicate mapping keys
- reject unknown standard fields outside `properties`
- reject invalid enum values
- reject invalid scalar types
- reject non-finite numeric values
- reject structurally invalid documents

Geometry validation is defined in `geometry/SPEC.md`.

## 15. File Extension

The file extension for this encoding is:

```text
.ssk
```

## 16. Version

The optional `version` field declares the specification version the file targets.

The value is a string in the form `major.minor`.

For this version:

```text
0.1
```

If absent, no version is declared.

Parsers must reject files with an unsupported major version.

Parsers must not reject files with an unknown minor version.

## 17. Binary Conversion Notes

The `.ssk` text encoding can represent decimal values with more precision than the `.sskb` binary encoding.

When writing `.sskb`, numeric values must be representable as finite IEEE 754 `f32` values. If a value cannot be represented as a finite `f32`, writers must reject the conversion.

If a value is representable as `f32` but loses precision, writers may round to the nearest representable `f32` value. Implementations that require exact round-tripping should preserve the original `.ssk` text or store additional metadata in `properties`.