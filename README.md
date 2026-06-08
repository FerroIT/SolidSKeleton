# SolidSKeleton

SolidSKeleton is an open geometry data format for representing skeleton-based solid geometry.

A document describes geometry as an ordered list of pieces. Each piece either generates material or subtracts from already-generated material. Pieces are either path-defined (two or more points, swept cross-section) or point-defined (one point, volumetric form).

Status: Current
Version: 0.1

## Specifications

Read in order:

1. [geometry/SPEC.md](geometry/SPEC.md) : geometry model and semantics
2. [format/ssk/SPEC.md](format/ssk/SPEC.md) : `.ssk` text encoding
3. [format/sskb/SPEC.md](format/sskb/SPEC.md) : `.sskb` binary encoding

## Examples

See [examples/](examples/).

## License

See [LICENSE.md](LICENSE.md).