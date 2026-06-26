/// Geometry coverage tests.
use crate::ssk::{Document, Mode, Piece, Point, Shape, Vec2, Vec3};
use crate::{TessellationConfig, process};

fn sphere(id: i64, center: [f64; 3], r: f64) -> Piece {
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
        size: Vec3 { x: r, y: r, z: r },
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    }
}

#[test]
fn test_sphere_vertex_count() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    // For resolution=32: n_lat=16, n_lon=32
    // Vertices: 2 + (n_lat - 1) * n_lon = 2 + 15*32 = 482
    assert_eq!(verts.len(), 482);
    assert!(!faces.is_empty());
}

#[test]
fn test_ellipsoid_different_radii() {
    let piece = sphere(0, [0.0, 0.0, 0.0], 5.0);
    let mut ellipsoid = piece.clone();
    ellipsoid.size = Vec3 {
        x: 10.0,
        y: 5.0,
        z: 3.0,
    };

    let doc = Document {
        pieces: vec![ellipsoid],
    };
    let config = TessellationConfig::new(32);
    let (verts, _faces) = process(&doc, &config).unwrap();

    // Check bounding box matches expected dimensions.
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;
    let mut min_z = f64::MAX;
    let mut max_z = f64::MIN;

    for v in &verts {
        if v[0] < min_x {
            min_x = v[0];
        }
        if v[0] > max_x {
            max_x = v[0];
        }
        if v[1] < min_y {
            min_y = v[1];
        }
        if v[1] > max_y {
            max_y = v[1];
        }
        if v[2] < min_z {
            min_z = v[2];
        }
        if v[2] > max_z {
            max_z = v[2];
        }
    }

    // X extent should be ~20 (radius 10), Y ~10, Z ~6.
    assert!((max_x - min_x - 20.0).abs() < 0.5);
    assert!((max_y - min_y - 10.0).abs() < 0.5);
    assert!((max_z - min_z - 6.0).abs() < 0.5);
}

#[test]
fn test_rotation_90_x() {
    let piece = sphere(0, [0.0, 0.0, 0.0], 5.0);
    let mut rotated = piece.clone();
    rotated.size = Vec3 {
        x: 5.0,
        y: 5.0,
        z: 10.0,
    };
    rotated.rotation = Some(Vec3 {
        x: 90.0,
        y: 0.0,
        z: 0.0,
    });

    let doc = Document {
        pieces: vec![rotated],
    };
    let config = TessellationConfig::new(32);
    let (verts, _faces) = process(&doc, &config).unwrap();

    // After 90-degree X rotation, the ellipsoid should be elongated along Y.
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;
    for v in &verts {
        if v[1] < min_y {
            min_y = v[1];
        }
        if v[1] > max_y {
            max_y = v[1];
        }
    }

    // Y extent should be ~20 (the original Z=10 diameter).
    let y_extent = max_y - min_y;
    assert!(
        (y_extent - 20.0).abs() < 0.5,
        "Y extent should be ~20, got {}",
        y_extent
    );
}

#[test]
fn test_min_resolution() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(3); // Minimum resolution.
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_intersect_mode() {
    let doc = Document {
        pieces: vec![
            sphere(0, [-1.5, 0.0, 0.0], 4.0),
            Piece {
                id: 1,
                points: vec![Point {
                    x: 1.5,
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
                    x: 4.0,
                    y: 4.0,
                    z: 4.0,
                },
                sides: None,
                rotation: None,
                mode: Mode::Intersect,
                affects: Some(vec![0]),
            },
        ],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    // Intersection of two overlapping spheres should produce a valid mesh.
    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_add_intersect_subtract_combo() {
    let doc = Document {
        pieces: vec![
            sphere(0, [0.0, 0.0, 0.0], 5.0),
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
                    x: 4.0,
                    y: 4.0,
                    z: 4.0,
                },
                sides: None,
                rotation: None,
                mode: Mode::Intersect,
                affects: Some(vec![0]),
            },
            Piece {
                id: 2,
                points: vec![Point {
                    x: -1.0,
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
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_resolution_affects_detail() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };

    let config_low = TessellationConfig::new(8);
    let (v1, f1) = process(&doc, &config_low).unwrap();

    let config_high = TessellationConfig::new(32);
    let (v2, f2) = process(&doc, &config_high).unwrap();

    assert!(
        v2.len() > v1.len(),
        "Higher resolution must produce more detail"
    );
    assert!(f2.len() > f1.len());
}

#[test]
fn test_cylinder_flat_caps() {
    let piece = Piece {
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
            x: 5.0,
            y: 5.0,
            z: 0.0,
        }, // Flat caps (z=0).
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_cone_rounded_caps() {
    let piece = Piece {
        id: 0,
        points: vec![
            Point {
                x: 0.0,
                y: 0.0,
                z: -10.0,
                size: Some(Vec3 {
                    x: 5.0,
                    y: 5.0,
                    z: 2.0,
                }),
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
                size: Some(Vec3 {
                    x: 1.0,
                    y: 1.0,
                    z: 2.0,
                }),
                rotation: None,
                curve_in: None,
                curve_out: None,
                transition_in: None,
                transition_out: None,
            },
        ],
        shape: Shape::Circle,
        size: Vec3 {
            x: 5.0,
            y: 5.0,
            z: 2.0,
        }, // Rounded caps (z=2).
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_ngon_shape() {
    let piece = Piece {
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
        shape: Shape::Ngon,
        size: Vec3 {
            x: 5.0,
            y: 5.0,
            z: 5.0,
        },
        sides: Some(6), // Hexagon.
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    // Hexagonal bipyramid: 8 vertices (2 poles + 6 equator), 12 faces.
    assert_eq!(verts.len(), 8);
    assert_eq!(faces.len(), 12);
}

#[test]
fn test_path_ngon_uses_polygon_cross_section() {
    use crate::tessellate::tessellate_piece;

    let piece = Piece {
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
        shape: Shape::Ngon,
        size: Vec3 {
            x: 1.0,
            y: 1.0,
            z: 0.0,
        },
        sides: Some(4),
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let (verts, faces) = tessellate_piece(&piece, 32).unwrap();

    assert_eq!(verts.len(), 38);
    assert_eq!(faces.len(), 72);
    let expected = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, -1.0, 0.0],
    ];
    for i in 0..4 {
        for axis in 0..3 {
            assert!((verts[i][axis] - expected[i][axis]).abs() < 1e-12);
        }
    }
}

#[test]
fn test_bezier_path() {
    let piece = Piece {
        id: 0,
        points: vec![
            Point {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                size: None,
                rotation: None,
                curve_in: Some(Vec3 {
                    x: 0.0,
                    y: 5.0,
                    z: 0.0,
                }),
                curve_out: None,
                transition_in: None,
                transition_out: None,
            },
            Point {
                x: 10.0,
                y: 0.0,
                z: 10.0,
                size: None,
                rotation: None,
                curve_in: None,
                curve_out: Some(Vec3 {
                    x: 5.0,
                    y: 0.0,
                    z: 0.0,
                }),
                transition_in: None,
                transition_out: None,
            },
        ],
        shape: Shape::Circle,
        size: Vec3 {
            x: 2.0,
            y: 2.0,
            z: 1.0,
        },
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_transition_curves() {
    let piece = Piece {
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
                transition_out: Some(Vec2 { x: 0.25, y: 0.75 }),
            },
            Point {
                x: 10.0,
                y: 0.0,
                z: 10.0,
                size: None,
                rotation: None,
                curve_in: None,
                curve_out: None,
                transition_in: Some(Vec2 { x: 0.25, y: 0.75 }),
                transition_out: None,
            },
        ],
        shape: Shape::Circle,
        size: Vec3 {
            x: 2.0,
            y: 2.0,
            z: 1.0,
        },
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_size_inheritance() {
    // Point without explicit size should inherit from piece.
    let piece = Piece {
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
            x: 5.0,
            y: 5.0,
            z: 5.0,
        },
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, _faces) = process(&doc, &config).unwrap();

    // Should produce a sphere with radius 5.
    assert!(!verts.is_empty());
}

#[test]
fn test_point_size_override() {
    let piece = Piece {
        id: 0,
        points: vec![Point {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            size: Some(Vec3 {
                x: 10.0,
                y: 10.0,
                z: 10.0,
            }),
            rotation: None,
            curve_in: None,
            curve_out: None,
            transition_in: None,
            transition_out: None,
        }],
        shape: Shape::Circle,
        size: Vec3 {
            x: 5.0,
            y: 5.0,
            z: 5.0,
        }, // Should be overridden by point size.
        sides: None,
        rotation: None,
        mode: Mode::Add,
        affects: None,
    };

    let doc = Document {
        pieces: vec![piece],
    };
    let config = TessellationConfig::new(32);
    let (verts, _faces) = process(&doc, &config).unwrap();

    // Should produce a sphere with radius 10.
    assert!(!verts.is_empty());
}

#[test]
fn test_multiple_pieces_union() {
    let doc = Document {
        pieces: vec![
            sphere(0, [-3.0, 0.0, 0.0], 2.0),
            sphere(1, [3.0, 0.0, 0.0], 2.0),
            sphere(2, [0.0, 0.0, 0.0], 2.0), // Overlaps with both.
        ],
    };

    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_empty_document() {
    let doc = Document { pieces: vec![] };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(verts.is_empty());
    assert!(faces.is_empty());
}

#[test]
fn test_single_point() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    assert!(!verts.is_empty());
    assert!(!faces.is_empty());
}

#[test]
fn test_mesh_is_manifold() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(32);
    let (_verts, faces) = process(&doc, &config).unwrap();

    // Check edge sharing: each edge should be shared by exactly 2 faces.
    use std::collections::HashMap;
    let mut edges: HashMap<(u32, u32), usize> = HashMap::new();
    for f in &faces {
        let e0 = if f[0] < f[1] {
            (f[0], f[1])
        } else {
            (f[1], f[0])
        };
        let e1 = if f[1] < f[2] {
            (f[1], f[2])
        } else {
            (f[2], f[1])
        };
        let e2 = if f[2] < f[0] {
            (f[2], f[0])
        } else {
            (f[0], f[2])
        };
        *edges.entry(e0).or_insert(0) += 1;
        *edges.entry(e1).or_insert(0) += 1;
        *edges.entry(e2).or_insert(0) += 1;
    }

    let boundary: usize = edges.values().filter(|c| *c == &1).count();
    let non_manifold: usize = edges.values().filter(|c| *c > &2).count();

    assert_eq!(boundary, 0, "Mesh should have no boundary edges");
    assert_eq!(non_manifold, 0, "Mesh should have no non-manifold edges");
}

#[test]
fn test_euler_characteristic() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    use std::collections::HashMap;
    let mut edges: HashMap<(u32, u32), usize> = HashMap::new();
    for f in &faces {
        let e0 = if f[0] < f[1] {
            (f[0], f[1])
        } else {
            (f[1], f[0])
        };
        let e1 = if f[1] < f[2] {
            (f[1], f[2])
        } else {
            (f[2], f[1])
        };
        let e2 = if f[2] < f[0] {
            (f[2], f[0])
        } else {
            (f[0], f[2])
        };
        *edges.entry(e0).or_insert(0) += 1;
        *edges.entry(e1).or_insert(0) += 1;
        *edges.entry(e2).or_insert(0) += 1;
    }

    let euler = verts.len() as i64 - edges.len() as i64 + faces.len() as i64;
    assert_eq!(euler, 2, "Euler characteristic should be 2 for a sphere");
}

#[test]
fn test_face_winding_consistency() {
    let doc = Document {
        pieces: vec![sphere(0, [0.0, 0.0, 0.0], 5.0)],
    };
    let config = TessellationConfig::new(32);
    let (verts, faces) = process(&doc, &config).unwrap();

    let mut inward = 0;
    for f in &faces {
        let a = verts[f[0] as usize];
        let b = verts[f[1] as usize];
        let c = verts[f[2] as usize];

        // Face normal via cross product.
        let dx1 = b[0] - a[0];
        let dy1 = b[1] - a[1];
        let dz1 = b[2] - a[2];
        let dx2 = c[0] - a[0];
        let dy2 = c[1] - a[1];
        let dz2 = c[2] - a[2];
        let nx = dy1 * dz2 - dz1 * dy2;
        let ny = dz1 * dx2 - dx1 * dz2;
        let nz = dx1 * dy2 - dy1 * dx2;

        // Centroid of face.
        let cx = (a[0] + b[0] + c[0]) / 3.0;
        let cy = (a[1] + b[1] + c[1]) / 3.0;
        let cz = (a[2] + b[2] + c[2]) / 3.0;

        // Dot product with radial direction (from origin to centroid).
        if nx * cx + ny * cy + nz * cz < 0.0 {
            inward += 1;
        }
    }

    assert_eq!(inward, 0, "All faces should be outward-facing");
}
