# SolidSKeleton
<a href="https://pypi.org/project/ssk">
  <img src="https://img.shields.io/badge/PyPI-ssk-blue?logo=python" alt="PyPI">
</a>
<a href="https://www.npmjs.com/package/@ferroit/ssk">
  <img src="https://img.shields.io/badge/npm-@ferroit/ssk-CB3837?logo=npm" alt="npm">
</a>
<a href="https://www.ferroit.com/">
  <img src="https://img.shields.io/badge/Website-ferroit.com-111111" alt="Website">
</a>
<br>

<p style="font-size: 8px; color: grey">Reference implementations are not part of the SSK specification</p>

---

SolidSKeleton is an open geometry data format for lightweight solid (CSG) modeling, designed to stay expressive without excessive structural or class overhead.

SolidSKeleton is built around two main concepts: user-defined sets of points, or a single point, with properties that create or remove material; hence Solid(material)Skeleton(Points).

A SolidSKeleton document `.ssk`/`.sskb` describes geometry as a list of pieces ordered by `id` for interpretation. Each piece either generates material or subtracts from generated material. Pieces are either path-defined (two or more points, swept cross-section) or point-defined (one point, volumetric form).

### What does SolidSKeleton bring to the table?

The format is lightly typed and enforces strict structural constraints, allowing humans and Large Language Models to generate geometry deterministically while minimizing heuristic behavior. Because the architecture relies on piece referencing, the resulting file sizes are incredibly small. This makes the compiled `.sskb` format highly efficient for data streaming, allowing thousands of generated objects to be transferred in just a few kilobytes. The simple syntax enables a lightweight local tessellation layer to translate these objects in milliseconds.

### Project Status

- Status: Current
- Version: 1.0
- Author: Rogier Goossen
  
As of 29-6-2026, the SolidSKeleton SPEC has been released under the stable ***v1.0*** version.
Implementations will continue under the ***v1.**** version.

## Specifications

Read in order:

1. [spec/geometry/SPEC.md](spec/geometry/SPEC.md): geometry model and semantics
2. [spec/format/ssk/SPEC.md](spec/format/ssk/SPEC.md): `.ssk` text encoding
3. [spec/format/sskb/SPEC.md](spec/format/sskb/SPEC.md): `.sskb` binary encoding

## Packages

[implementation/packages/](implementation/packages/).

The packages are API wrappers over the rust core @`implementation/core/` and in langauge mesh to ssk estimator. 

## Core

[implementation/core/](implementation/core/).

The rust core is dependents on [Manifold](https://github.com/elalish/manifold). The core is reference implimentation and is based on the SolidSKeleton SPEC.

## Examples

[examples/](examples/).

The examples includes screenshots, ssk, sskb and glb files.


## License

[LICENSE](LICENSE).

And the full license files can be found at [/licenses](/licenses/).

---

<img width="256" alt="FerroIT logo" src="https://github.com/user-attachments/assets/7d4e1963-68a4-4a04-96f3-b64f8c4c1977"/>
