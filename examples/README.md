# SolidSKeleton Examples

This directory contains folders with example `.ssk` files that demonstrate valid SolidSKeleton documents.

All files in this example directory have been parsed through the reference scripts in `/implementation/packages` and rendered in the [glTF Viewer](https://gltf-viewer.donmccurdy.com/) by Don McCurdy.

---

## `csg_cube.ssk` / `csg_cube.sskb`
A CSG example cube using `add`, `subtract`, and `intersect`

The `.ssk` file is *943 bytes* and the `.sskb` file is *314 bytes*.

The CSG cube uses many core CSG principles.

<img src="csg_cube/csg_cube.png" alt="csg_cube.png" width="128"/>

---

## `ladder.ssk` / `ladder.sskb`
A ladder with 14 steps

The `.ssk` file is *2347 bytes* and the `.sskb` file is *870 bytes*.

The ladder describes the use of the `from` class strongly.

<img src="ladder/ladder.png" alt="ladder_upright.png" width="128"/>

---

## Primitives

A collection of eight standard geometric primitives, each demonstrating basic shape construction techniques.

### `cube.ssk` / `cube.sskb`
A regular cube using a 4-sided `ngon` with 45° rotation

The `.ssk` file is *283 bytes* and the `.sskb` file is *98 bytes*.

<img src="primitives/cube/cube.png" alt="cube.png" width="128"/>

### `sphere.ssk` / `sphere.sskb`
An ellipsoid using a point-defined `circle` shape

The `.ssk` file is *162 bytes* and the `.sskb` file is *64 bytes*.

<img src="primitives/sphere/sphere.png" alt="sphere.png" width="128"/>

### `cuboid.ssk` / `cuboid.sskb`
A rectangular box with extended height

The `.ssk` file is *283 bytes* and the `.sskb` file is *98 bytes*.

<img src="primitives/cuboid/cuboid.png" alt="cuboid.png" width="128"/>

### `triangular_prism.ssk` / `triangular_prism.sskb`
A triangular cross-section swept along a path

The `.ssk` file is *217 bytes* and the `.sskb` file is *86 bytes*.

<img src="primitives/triangular_prism/triangular_prism.png" alt="triangular_prism.png" width="128"/>

### `hemisphere.ssk` / `hemisphere.sskb`
A half-sphere with tapered cap

The `.ssk` file is *273 bytes* and the `.sskb` file is *94 bytes*.

<img src="primitives/hemisphere/hemisphere.png" alt="hemisphere.png" width="128"/>

### `cylinder.ssk` / `cylinder.sskb`
A circular cross-section swept along a path

The `.ssk` file is *205 bytes* and the `.sskb` file is *82 bytes*.

<img src="primitives/cylinder/cylinder.png" alt="cylinder.png" width="128"/>

### `cone.ssk` / `cone.sskb`
A tapered circle from base to apex

The `.ssk` file is *268 bytes* and the `.sskb` file is *94 bytes*.

<img src="primitives/cone/cone.png" alt="cone.png" width="128"/>

### `pyramid.ssk` / `pyramid.sskb`
A tapered 4-sided `ngon` from base to apex

The `.ssk` file is *346 bytes* and the `.sskb` file is *110 bytes*.

<img src="primitives/pyramid/pyramid.png" alt="pyramid.png" width="128"/>

---

## `knot.ssk` / `knot.sskb`
A trefoil knot with smooth path and curved controls

The `.ssk` file is *35106 bytes* and the `.sskb` file is *8128 bytes*.

The knot demonstrates complex path-defined geometry with extensive curve controls.

<img src="knot/knot.png" alt="knot.png" width="128"/>
