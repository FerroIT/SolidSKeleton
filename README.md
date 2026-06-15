# SolidSKeleton
*<sup>[Python package](https://pypi.org/project/ssk) .. [NPM package](https://www.npmjs.com/package/@ferroit/ssk) .. [FerroIT website](https://www.ferroit.com/)</sup>*


SolidSKeleton is an open geometry data format for lightweight solid (CSG) modeling, designed to stay expressive without excessive structural or class overhead.

SolidSKeleton works around 2 main principles, which is the user defined sets of points or singular point, with properties allowing for it to create or remove material, hence Solid(meterial)Skeleton(Points)

A SolidSKeleton document `.ssk`/`.sskb` describes geometry as a list of pieces ordered by `id` for interpretation. Each piece either generates material or subtracts from generated material. Pieces are either path-defined (two or more points, swept cross-section) or point-defined (one point, volumetric form).

### What does SolidSKeleton bring to the table?

The format is lightly typed and enforces strict structural constraints, allowing Humans and maybe just as importantly nowadays; Large Language Models to generate geometry deterministically while minimizing heuristic behavior. Because the architecture relies on piece referencing, the resulting file sizes are incredibly small. This makes the compiled .sskb format highly efficient for data streaming, allowing thousands of generated objects to be transferred in just a few kilobytes. The simple syntax enables a lightweight local tessellation layer to translate these objects in milliseconds.

### Project Status

- Status: Current
- Version: 0.9
- Author: Rogier Goossen
  
This specification is in early development and is subject to change. The format should be considered beta until version 1.0.

## Specifications

Read in order:

1. [geometry/SPEC.md](geometry/SPEC.md): geometry model and semantics
2. [format/ssk/SPEC.md](format/ssk/SPEC.md): `.ssk` text encoding
3. [format/sskb/SPEC.md](format/sskb/SPEC.md): `.sskb` binary encoding

## Reference

See [reference/](reference/).

## Examples

See [examples/](examples/).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

See [LICENSE.md](LICENSE.md).

---

<img width="256" alt="FerroIT logo" src="https://github.com/user-attachments/assets/7d4e1963-68a4-4a04-96f3-b64f8c4c1977"/>
