# SolidSKeleton Roadmap

All roadmap items under a version have to be completed for that version bump to happen.

## v0.1 -> v0.5

- [ ] Adding of the groups object, grouping objects by wrapping indexes under a group index would allow refrencing of existing geometry
- [x] 3rd boolean type on mode, "intersect", which will only keep intersecting geometry, treated as add. outlying pieces are ignored (and not treated as subtract)
- [x] Per point size and rotation flags, with an optional bezier transition variable.

## v0.5 -> v0.6

- [ ] Adding a flag to the affects class, to allow for using the document order (id) as the affecting order.

## v0.6 -> v0.7

- [ ] Removal of file order rules, replacing to be more flexible, allowing mixed id's over the file, but deciding the order based on the id's index.  e.g. [1, 2, ***4***, ***3***] will now be allowed, read like [1, 2, 3, 4]
