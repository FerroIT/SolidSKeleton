# SolidSKeleton Spec Deprecation List

## v0.2 -> v0.3
`bezier_in` and `bezier_out` have been deprecated because they were renamed to `curve_in` and `curve_out`.

With the addition of the `transition_in` and `transition_out` fields, it was clearer to describe the action rather than the mathematical function, as both use Bezier calculations.
