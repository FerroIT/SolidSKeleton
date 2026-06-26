use crate::resolve::{RawPiece, resolve};
use crate::ssk::{Document, Mode, Piece, Point, Shape, Vec3};
use crate::{TessellationConfig, process};

fn sphere_piece(id: i64, center: [f64; 3], radius: f64) -> Piece {
    Piece {
        id,
        points: vec![Point {
            x: center[0],
            y: center[1],
            z: center[2],
            size: None,
            rotation: None,
            curve_in: None,
            curve_out: None,
            transition_in: None,
            transition_out: None,
        }],
        shape: Shape::Circle,
        size: Vec3 {
            x: radius,
            y: radius,
            z: radius,
        },
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    }
}

#[test]
fn test_single_sphere() {
    let doc = Document {
        pieces: vec![sphere_piece(0, [0.0, 0.0, 0.0], 5.0)],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).expect("tessellation should succeed");

    assert!(!verts.is_empty(), "sphere must have vertices");
    assert!(!faces.is_empty(), "sphere must have faces");

    // All face indices valid.
    for f in &faces {
        assert!(f[0] < verts.len() as u32, "face index out of bounds");
        assert!(f[1] < verts.len() as u32, "face index out of bounds");
        assert!(f[2] < verts.len() as u32, "face index out of bounds");
    }

    // Vertices roughly centered around origin.
    let cx = verts.iter().map(|v| v[0]).sum::<f64>() / verts.len() as f64;
    let cy = verts.iter().map(|v| v[1]).sum::<f64>() / verts.len() as f64;
    let cz = verts.iter().map(|v| v[2]).sum::<f64>() / verts.len() as f64;
    assert!((cx - 0.0).abs() < 1.0, "center X should be near 0");
    assert!((cy - 0.0).abs() < 1.0, "center Y should be near 0");
    assert!((cz - 0.0).abs() < 1.0, "center Z should be near 0");
}

#[test]
fn test_path_defined_cylinder() {
    let doc = Document {
        pieces: vec![Piece {
            id: 0,
            points: vec![
                Point {
                    x: 0.0,
                    y: 0.0,
                    z: -10.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: None,
                    transition_out: None,
                },
                Point {
                    x: 0.0,
                    y: 0.0,
                    z: 10.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: None,
                    transition_out: None,
                },
            ],
            shape: Shape::Circle,
            size: Vec3 {
                x: 3.0,
                y: 3.0,
                z: 0.0,
            },
            sides: None,
            rotation: None,
            mode: Mode::Add,
            affects: None,
        }],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).expect("tessellation should succeed");

    assert!(!verts.is_empty(), "cylinder must have vertices");
    assert!(!faces.is_empty(), "cylinder must have faces");

    for f in &faces {
        assert!(f[0] < verts.len() as u32);
        assert!(f[1] < verts.len() as u32);
        assert!(f[2] < verts.len() as u32);
    }
}

#[test]
fn test_two_pieces_boolean_subtract() {
    let doc = Document {
        pieces: vec![
            sphere_piece(0, [0.0, 0.0, 0.0], 5.0),
            Piece {
                id: 1,
                points: vec![Point {
                    x: 2.0,
                    y: 0.0,
                    z: 0.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: None,
                    transition_out: None,
                }],
                shape: Shape::Circle,
                size: Vec3 {
                    x: 3.0,
                    y: 3.0,
                    z: 3.0,
                },
                sides: None,
                rotation: None,
                mode: Mode::Subtract,
                affects: Some(vec![0]),
            },
        ],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).expect("boolean should succeed");

    assert!(
        !verts.is_empty(),
        "result must have vertices after subtraction"
    );
    assert!(
        !faces.is_empty(),
        "result must have faces after subtraction"
    );
}

#[test]
fn test_degenerate_piece_returns_none() {
    let doc = Document {
        pieces: vec![Piece {
            id: 0,
            points: vec![Point {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                size: None,
                rotation: None,
                curve_in: None,
                curve_out: None,
                transition_in: None,
                transition_out: None,
            }],
            shape: Shape::Circle,
            size: Vec3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            }, // All zero -- degenerate
            sides: None,
            rotation: None,
            mode: Mode::Add,
            affects: None,
        }],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).expect("should not error");

    assert!(
        verts.is_empty(),
        "degenerate sphere should have no vertices"
    );
    assert!(faces.is_empty(), "degenerate sphere should have no faces");
}

#[test]
fn test_resolution_affects_detail() {
    let doc = Document {
        pieces: vec![sphere_piece(0, [0.0, 0.0, 0.0], 5.0)],
    };

    let low = TessellationConfig::new(8);
    let high = TessellationConfig::new(64);

    let (v_low, _) = process(&doc, &low).unwrap();
    let (v_high, _) = process(&doc, &high).unwrap();

    assert!(
        v_high.len() > v_low.len(),
        "higher resolution must produce more detail"
    );
}

#[test]
fn test_resolution_below_minimum_is_rejected() {
    let doc = Document {
        pieces: vec![sphere_piece(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(2);

    assert!(process(&doc, &config).is_err());
}

#[test]
fn test_inheritance_chain_uses_resolved_parent() {
    let pieces = resolve(vec![
        RawPiece {
            id: 0,
            from: None,
            points: Some(vec![Point {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                size: None,
                rotation: None,
                curve_in: None,
                curve_out: None,
                transition_in: None,
                transition_out: None,
            }]),
            size: Some(Vec3 {
                x: 1.0,
                y: 1.0,
                z: 1.0,
            }),
            shape: Some(Shape::Circle),
            sides: None,
            rotation: None,
            mode: Some(Mode::Subtract),
            affects: Some(vec![1]),
        },
        RawPiece {
            id: 1,
            from: Some(0),
            points: None,
            size: None,
            shape: None,
            sides: None,
            rotation: None,
            mode: None,
            affects: None,
        },
        RawPiece {
            id: 2,
            from: Some(1),
            points: None,
            size: None,
            shape: None,
            sides: None,
            rotation: None,
            mode: None,
            affects: None,
        },
    ])
    .expect("inheritance should resolve");

    assert_eq!(pieces[2].shape, Shape::Circle);
    assert_eq!(pieces[2].mode, Mode::Subtract);
    assert_eq!(pieces[2].affects, Some(vec![1]));
}

#[test]
fn test_invalid_affects_is_rejected() {
    let doc = Document {
        pieces: vec![
            sphere_piece(0, [0.0, 0.0, 0.0], 1.0),
            Piece {
                affects: Some(vec![0, 0]),
                ..sphere_piece(1, [2.0, 0.0, 0.0], 1.0)
            },
        ],
    };

    assert!(doc.validate().is_err());
}

#[test]
fn test_transition_must_be_monotone() {
    let doc = Document {
        pieces: vec![Piece {
            id: 0,
            points: vec![
                Point {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: None,
                    transition_out: Some(crate::ssk::Vec2 { x: 0.8, y: 0.0 }),
                },
                Point {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: Some(crate::ssk::Vec2 { x: 0.2, y: 1.0 }),
                    transition_out: None,
                },
            ],
            shape: Shape::Circle,
            size: Vec3 {
                x: 1.0,
                y: 1.0,
                z: 1.0,
            },
            sides: None,
            rotation: None,
            mode: Mode::Add,
            affects: None,
        }],
    };

    assert!(doc.validate().is_err());
}

#[test]
fn test_curve_controls_must_be_finite() {
    let doc = Document {
        pieces: vec![Piece {
            id: 0,
            points: vec![
                Point {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: Some(Vec3 {
                        x: f64::NAN,
                        y: 0.0,
                        z: 0.0,
                    }),
                    transition_in: None,
                    transition_out: None,
                },
                Point {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                    size: None,
                    rotation: None,
                    curve_in: None,
                    curve_out: None,
                    transition_in: None,
                    transition_out: None,
                },
            ],
            shape: Shape::Circle,
            size: Vec3 {
                x: 1.0,
                y: 1.0,
                z: 1.0,
            },
            sides: None,
            rotation: None,
            mode: Mode::Add,
            affects: None,
        }],
    };

    assert!(doc.validate().is_err());
}
