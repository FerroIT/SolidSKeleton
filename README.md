# SolidSKeleton

SolidSKeleton is an open geometry data format for lightweight solid (CSG) modeling, designed to stay expressive without excessive structural or class overhead.

SolidSKeleton works around 2 main principles, which is the user defined sets of points or singular point, with properties allowing for it to create or remove material, hence Solid(meterial)Skeleton(Points)

A SolidSKeleton document `.ssk`/`.sskb` describes geometry as a list of pieces ordered by `id` for interpretation. Each piece either generates material or subtracts from generated material. Pieces are either path-defined (two or more points, swept cross-section) or point-defined (one point, volumetric form).

- Status: Current
- Version: 0.5
- Author: Rogier Goossen
  
This specification is in early development and is subject to change. The format should be considered beta until version 1.0.

## Specifications

Read in order:

1. [geometry/SPEC.md](geometry/SPEC.md) : geometry model and semantics
2. [format/ssk/SPEC.md](format/ssk/SPEC.md) : `.ssk` text encoding
3. [format/sskb/SPEC.md](format/sskb/SPEC.md) : `.sskb` binary encoding

## Examples

See [examples/](examples/).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

See [LICENSE.md](LICENSE.md).
