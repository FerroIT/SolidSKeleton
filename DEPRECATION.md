# SolidSKeleton Deprecation list

## v0.2 -> v0.3
`bezier_in` and `bezier_out` have been deprecated because of the name change to to `curve_in` and `curve_out`

With the addition of the transition_in and transition_out classes, it was better to describe the action rather the mathmatical function, as both use bezier calculations.
