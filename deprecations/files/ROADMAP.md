# SolidSKeleton Roadmap

All roadmap items under a version must be completed before that version bump can happen.

## 🎉 v0.1 -> v0.5

- [ ] ~~Adding a groups object, grouping objects by wrapping indices under a group index, would allow referencing existing geometry~~ ***See option 2***
- [x] Add the `from` field to pieces, inheriting all fields. This makes all fields optional for a piece with `from`; when a field is added, it overrides the inherited field.
- [x] Add a third boolean `mode`, `intersect`, which only keeps intersecting geometry and is treated as `add`. Non-overlapping pieces are ignored and are not treated as `subtract`.
- [x] Add per-point size and rotation fields with optional Bezier transition controls.

## 🎉 v0.5 -> v0.6

- [x] Remove file-order rules for more flexibility, allowing mixed IDs in the file while determining order by sorted `id`. For example, [1, 2, ***4***, ***3***] is now allowed and read as [1, 2, 3, 4]

## 🎉 v0.6 -> v0.7

- [x] Add reference implementation, documentation, and parser documents

## 🎉 v0.7 -> v0.8

- [x] Fill the example subfolder with more high-quality examples
- [x] Make rotation optional, default to 0,0,0

## 🎉 v0.8 -> v0.9

- [x] Add more languages as a reference
- [x] Clean up Python implementation in reference
- [x] Fix typos and structural/syntax issues in SPEC files

## v0.9 -> v1.0rc1

- [x] Test suite with better validation of text and binary formats.
