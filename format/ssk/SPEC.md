# SSK Text Encoding Specification

Status: Current
Version: 0.6
Applies to: `.ssk`

## 1. Purpose

`.ssk` is the text encoding of the SolidSKeleton geometry model.

This document defines how SolidSKeleton data is represented as text.

The object structure defined here is also the shared structural reference for `.sskb`, except where `format/sskb/SPEC.md` defines binary-specific representation.

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

The root object must be a mapping, not a sequence or scalar.

Root fields:

- `version` : optional
- `pieces` : required
- `properties` : optional mapping

Unknown root fields are invalid.

## 5. Piece Object

Each item in `pieces` must be a mapping.

Piece fields:

- `id` : required integer
- `from` : optional integer
- `points` : required list
- `rotation` : required vector3
- `size` : required vector3
- `shape` : required string
- `sides` : optional integer
- `mode` : optional string
- `affects` : optional list of integers
- `properties` : optional mapping

If `from` is present, piece fields other than `id` may be omitted.

Unknown piece fields are invalid.

## 6. Point Object

Each item in `points` must be a mapping.

Point fields:

- `x` : required number
- `y` : required number
- `z` : required number
- `curve_in` : optional vector3
- `curve_out` : optional vector3
- `size` : optional vector3
- `rotation` : optional vector3
- `transition_in` : optional vector2
- `transition_out` : optional vector2

Unknown point fields are invalid.

## 7. Vector3 Object

A vector3 must be a mapping with:

- `x` : required number
- `y` : required number
- `z` : required number

Unknown vector3 fields are invalid.

## 8. Vector2 Object

A vector2 must be a mapping with:

- `x` : required number
- `y` : required number

Unknown vector2 fields are invalid.

## 9. Scalar Types

### 9.1 Numbers

Numbers may be integers or decimals.

Parsers must support signed decimal numbers.

Numbers must be finite. YAML values such as `.nan`, `.inf`, and `-.inf` are invalid for SolidSKeleton numeric fields.

Boolean values are not valid numbers, even if a YAML parser represents booleans as numeric values internally.

### 9.2 Integers

The following fields must be integers:

- `id`
- `from`
- `sides`
- `affects[]`

Integer fields must not contain fractional values.

### 9.3 Strings

The following string values are defined.

For `shape`:

- `circle`
- `ngon`

For `mode`:

- `add`
- `subtract`
- `intersect`

String values are case-sensitive.

## 10. Lists

The following fields are lists:

- `pieces`
- `points`
- `affects`

List order must be preserved for round-tripping.

Geometry semantics do not depend on `pieces` file order; piece order is defined by ascending `id`.

## 11. Properties

`properties` is encoded as a YAML mapping.

`properties` may appear:

- at the root level
- on a piece

Property keys must be strings.

Property values may be null, booleans, finite numbers, strings, sequences, or nested mappings.

Geometry rules for `properties` are defined in `geometry/SPEC.md`.

## 12. Optional Fields

The following fields are optional:

- root `version`
- root `properties`
- piece `from`
- piece `sides`
- piece `mode`
- piece `affects`
- piece `properties`
- point `curve_in`
- point `curve_out`
- point `size`
- point `rotation`
- point `transition_in`
- point `transition_out`

Omitted optional fields decode as absent in the geometry model. Geometry defaults and interpretation are defined in `geometry/SPEC.md`.

## 13. Field Order

Writers should emit fields in a stable order.

Recommended root order:

1. `version`
2. `pieces`
3. `properties`

Recommended piece field order:

1. `id`
2. `from`
3. `points`
4. `rotation`
5. `size`
6. `shape`
7. `sides`
8. `mode`
9. `affects`
10. `properties`

Recommended point field order:

1. `x`
2. `y`
3. `z`
4. `curve_in`
5. `curve_out`
6. `size`
7. `rotation`
8. `transition_in`
9. `transition_out`

Recommended vector field order:

1. `x`
2. `y`
3. `z`

Recommended transition vector field order:

1. `x`
2. `y`

Parsers must not require a specific field order.

## 14. Comments

YAML comments are allowed.

Writers should not rely on comments to store required data.

## 15. Parser Requirements

A conforming `.ssk` parser must:

- parse UTF-8 YAML input
- require a root mapping
- require `pieces`
- preserve `pieces` file order when round-tripping
- preserve `points` order
- reject YAML anchors, aliases, explicit tags, and directives
- reject duplicate mapping keys
- reject unknown standard fields outside `properties`
- reject invalid enum values
- reject invalid scalar types
- reject non-finite numeric values
- reject structurally invalid documents
- require `points`, `rotation`, `size`, and `shape` unless `from` is present

Geometry validation is defined in `geometry/SPEC.md`.

## 16. File Extension

The file extension for this encoding is:

```text
.ssk
```

## 17. Version

The optional `version` field declares the specification version the file targets.

The value is a string in the form `major.minor`.

For this version:

```text
0.6
```

If absent, no version is declared.

Parsers must reject files with an unsupported major version.