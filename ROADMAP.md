# SolidSKeleton Roadmap

All roadmap items under a version have to be completed for that version bump to happen.

## 🎉 v0.1 -> v0.5

- [ ] ~~Adding of the groups object, grouping objects by wrapping indexes under a group index would allow refrencing of existing geometry~~ ***See option 2***
- [x] Adding of the from class to the object, inheriting all fields, which makes all fields optional for a piece with from class, when field is added it overwrites the inherited field.
- [x] 3rd boolean type on mode, "intersect", which will only keep intersecting geometry, treated as add. outlying pieces are ignored (and not treated as subtract)
- [x] Per point size and rotation flags, with an optional bezier transition variable.

## 🎉 v0.5 -> v0.6

- [x] Removal of file order rules, replacing to be more flexible, allowing mixed id's over the file, but deciding the order based on the id's index.  e.g. [1, 2, ***4***, ***3***] will now be allowed, read like [1, 2, 3, 4]

## 🎉 v0.6 -> v0.7

- [x] Add refrence implementation, documentation and parsing documents

## 🎉 v0.7 -> v0.8

- [x] Fill the example subfolder with more high quality examples
- [x] Make rotation optional, default to 0,0,0

## v0.8 -> v0.9

- [ ] Add more languages as a refrence
- [ ] Cleanup python implementation in refrence
- [ ] Fix typos and structural/syntax issues in SPEC files

## v0.9 -> v1.0.rc1

- [ ] Testing suite, better validation of text and binary format.
- [ ] t.b.d
