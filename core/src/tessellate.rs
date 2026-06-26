/// Tessellation from SolidSKeleton pieces to raw mesh vertices and face indices.
///
/// No formatting or file I/O.
use crate::ssk::{Piece, Point, Shape, Vec2, Vec3};
use crate::{Face, Mesh, Vertex};

const EPS: f64 = 1e-12;
const MIN_RESOLUTION: i32 = 3;

/// Tessellate a single piece into vertices and triangle face indices.
///
/// Returns `None` for degenerate pieces.
pub fn tessellate_piece(piece: &Piece, resolution: i32) -> Option<Mesh> {
    if resolution < MIN_RESOLUTION {
        return None;
    }

    if piece.points.len() == 1 {
        tessellate_point_defined(piece, resolution)
    } else {
        tessellate_path_defined(piece, resolution)
    }
}

// ── Vector math helpers ──────────────────────────────────────────────

fn vec3(x: f64, y: f64, z: f64) -> [f64; 3] {
    [x, y, z]
}

fn v_add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn v_sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn v_scale(v: [f64; 3], s: f64) -> [f64; 3] {
    [v[0] * s, v[1] * s, v[2] * s]
}

fn v_dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn v_cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn v_norm(v: [f64; 3]) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

fn normalize(v: [f64; 3]) -> [f64; 3] {
    let n = v_norm(v);
    if n < EPS {
        [0.0, 0.0, 0.0]
    } else {
        [v[0] / n, v[1] / n, v[2] / n]
    }
}

fn project_onto_plane(v: [f64; 3], normal: [f64; 3]) -> [f64; 3] {
    let d = v_dot(v, normal);
    v_sub(v, v_scale(normal, d))
}

// ── Rotation matrix (XYZ Euler, extrinsic) ───────────────────────────

fn rotation_matrix_xyz(rx: f64, ry: f64, rz: f64) -> [[f64; 3]; 3] {
    let rx = rx.to_radians();
    let ry = ry.to_radians();
    let rz = rz.to_radians();
    let cx = rx.cos();
    let sx = rx.sin();
    let cy = ry.cos();
    let sy = ry.sin();
    let cz = rz.cos();
    let sz = rz.sin();

    [
        [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
        [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
        [-sy, sx * cy, cx * cy],
    ]
}

fn mat_vec_mul(m: [[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// Minimal rotation matrix that maps `v_from` to `v_to`.
fn minimal_rotation(v_from: [f64; 3], v_to: [f64; 3]) -> [[f64; 3]; 3] {
    let c = v_dot(v_from, v_to);
    if (c - 1.0).abs() < EPS {
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    }
    if (c + 1.0).abs() < EPS {
        let perp = vec3(1.0, 0.0, 0.0);
        let axis = if v_dot(v_from, perp).abs() > 0.9 {
            normalize(vec3(0.0, 1.0, 0.0))
        } else {
            normalize(v_cross(v_from, perp))
        };
        let mut r = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                r[i][j] = 2.0 * axis[i] * axis[j] - if i == j { 1.0 } else { 0.0 };
            }
        }
        return r;
    }

    let cross = v_cross(v_from, v_to);
    let s = v_norm(cross);
    let k = [
        [0.0, -cross[2], cross[1]],
        [cross[2], 0.0, -cross[0]],
        [-cross[1], cross[0], 0.0],
    ];

    let mut r = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for i in 0..3 {
        for j in 0..3 {
            let k2 = k[i][0] * k[0][j] + k[i][1] * k[1][j] + k[i][2] * k[2][j];
            r[i][j] += k[i][j] + ((1.0 - c) / (s * s)) * k2;
        }
    }
    r
}

// ── Cubic Bezier ─────────────────────────────────────────────────────

fn cubic_bezier(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3], p3: [f64; 3], t: f64) -> [f64; 3] {
    let u = 1.0 - t;
    v_add(
        v_add(v_scale(p0, u * u * u), v_scale(p1, 3.0 * u * u * t)),
        v_add(v_scale(p2, 3.0 * u * t * t), v_scale(p3, t * t * t)),
    )
}

fn cubic_bezier_deriv(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3], p3: [f64; 3], t: f64) -> [f64; 3] {
    let u = 1.0 - t;
    v_add(
        v_add(
            v_scale(v_sub(p1, p0), 3.0 * u * u),
            v_scale(v_sub(p2, p1), 6.0 * u * t),
        ),
        v_scale(v_sub(p3, p2), 3.0 * t * t),
    )
}

// ── Transition curve (Newton's method) ───────────────────────────────

fn solve_transition(t1: Vec2, t2: Vec2, u_target: f64) -> f64 {
    if u_target <= 0.0 {
        return 0.0;
    }
    if u_target >= 1.0 {
        return 1.0;
    }

    let mut t = u_target;
    for _ in 0..50 {
        let u = 1.0 - t;
        let x = 3.0 * u * u * t * t1.x + 3.0 * u * t * t * t2.x + t * t * t;
        let dx = 3.0 * u * u * t1.x + 6.0 * u * t * (t2.x - t1.x) + 3.0 * t * t * (1.0 - t2.x);
        if dx.abs() < 1e-15 {
            break;
        }
        let t_new = (t - (x - u_target) / dx).clamp(0.0, 1.0);
        if (t_new - t).abs() < 1e-12 {
            t = t_new;
            break;
        }
        t = t_new;
    }

    let u = 1.0 - t;
    3.0 * u * u * t * t1.y + 3.0 * u * t * t * t2.y + t * t * t
}

// ── Interpolation helpers ────────────────────────────────────────────

fn shortest_angle_delta(a: f64, b: f64) -> f64 {
    let d = ((b - a) % 360.0 + 360.0) % 360.0;
    if d > 180.0 { d - 360.0 } else { d }
}

fn interpolate_rotation(r0: Vec3, r1: Vec3, v: f64) -> Vec3 {
    Vec3 {
        x: r0.x + shortest_angle_delta(r0.x, r1.x) * v,
        y: r0.y + shortest_angle_delta(r0.y, r1.y) * v,
        z: r0.z + shortest_angle_delta(r0.z, r1.z) * v,
    }
}

fn interpolate_size(s0: Vec3, s1: Vec3, v: f64) -> Vec3 {
    Vec3 {
        x: (s0.x + (s1.x - s0.x) * v).max(0.0),
        y: (s0.y + (s1.y - s0.y) * v).max(0.0),
        z: (s0.z + (s1.z - s0.z) * v).max(0.0),
    }
}

// ── Effective size/rotation at a point ───────────────────────────────

fn eff_size(pt: &Point, piece: &Piece) -> Vec3 {
    pt.size.unwrap_or(piece.size)
}

fn eff_rot(pt: &Point, piece: &Piece) -> Vec3 {
    pt.rotation.or(piece.rotation).unwrap_or(Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    })
}

fn is_degenerate(sx: f64, sy: f64, sz: f64) -> bool {
    (sx == 0.0) as i32 + (sy == 0.0) as i32 + (sz == 0.0) as i32 >= 2
}

// ── Cross-section vertex count ───────────────────────────────────────

fn cross_n(piece: &Piece, resolution: i32) -> usize {
    if piece.shape == Shape::Ngon {
        piece.sides.unwrap_or(resolution as i64) as usize
    } else {
        resolution as usize
    }
}

// ── Point-defined pieces ─────────────────────────────────────────────

fn tessellate_point_defined(piece: &Piece, resolution: i32) -> Option<Mesh> {
    let pt = &piece.points[0];
    let sx = eff_size(pt, piece).x;
    let sy = eff_size(pt, piece).y;
    let sz = eff_size(pt, piece).z;

    if is_degenerate(sx, sy, sz) {
        return None;
    }

    let pos = vec3(pt.x, pt.y, pt.z);
    let r = rotation_matrix_xyz(
        eff_rot(pt, piece).x,
        eff_rot(pt, piece).y,
        eff_rot(pt, piece).z,
    );

    match piece.shape {
        Shape::Circle => ellipsoid(pos, sx, sy, sz, &r, resolution),
        Shape::Ngon => bipyramid(pos, sx, sy, sz, &r, piece.sides.unwrap_or(4) as usize),
    }
}

fn ellipsoid(c: [f64; 3], sx: f64, sy: f64, sz: f64, r: &[[f64; 3]; 3], n: i32) -> Option<Mesh> {
    let n_lat = (n / 2).max(4) as usize;
    let n_lon = n.max(6) as usize;

    let mut vs: Vec<Vertex> = Vec::new();
    // North pole
    vs.push(v_add(c, mat_vec_mul(*r, vec3(0.0, 0.0, sz))));

    for i in 1..n_lat {
        let phi = std::f64::consts::PI * i as f64 / n_lat as f64;
        let sp = phi.sin();
        let cp = phi.cos();
        for j in 0..n_lon {
            let th = 2.0 * std::f64::consts::PI * j as f64 / n_lon as f64;
            vs.push(v_add(
                c,
                mat_vec_mul(*r, vec3(sx * sp * th.cos(), sy * sp * th.sin(), sz * cp)),
            ));
        }
    }

    // South pole
    vs.push(v_add(c, mat_vec_mul(*r, vec3(0.0, 0.0, -sz))));

    let mut fs: Vec<Face> = Vec::new();

    // Top cap (CCW when viewed from outside = above north pole)
    for j in 0..n_lon {
        fs.push([0, 1 + j as u32, 1 + ((j + 1) % n_lon) as u32]);
    }

    // Middle bands (CCW when viewed from outside)
    for i in 0..(n_lat - 2) {
        let a0 = (1 + i * n_lon) as u32;
        let b0 = (1 + (i + 1) * n_lon) as u32;
        for j in 0..n_lon {
            let jn = ((j + 1) % n_lon) as u32;
            fs.push([a0 + j as u32, b0 + j as u32, a0 + jn]);
            fs.push([b0 + j as u32, b0 + jn, a0 + jn]);
        }
    }

    // Bottom cap (CCW when viewed from outside = below south pole)
    let bot = 1 + (n_lat - 1) * n_lon;
    let last = 1 + (n_lat - 2) * n_lon;
    for j in 0..n_lon {
        fs.push([
            bot as u32,
            last as u32 + ((j + 1) % n_lon) as u32,
            last as u32 + j as u32,
        ]);
    }

    Some((vs, fs))
}

fn bipyramid(
    c: [f64; 3],
    sx: f64,
    sy: f64,
    sz: f64,
    r: &[[f64; 3]; 3],
    sides: usize,
) -> Option<Mesh> {
    let mut vs: Vec<Vertex> = Vec::new();
    // North and south poles
    vs.push(v_add(c, mat_vec_mul(*r, vec3(0.0, 0.0, sz))));
    vs.push(v_add(c, mat_vec_mul(*r, vec3(0.0, 0.0, -sz))));

    for i in 0..sides {
        let a = 2.0 * std::f64::consts::PI * i as f64 / sides as f64;
        vs.push(v_add(
            c,
            mat_vec_mul(*r, vec3(sx * a.cos(), sy * a.sin(), 0.0)),
        ));
    }

    let mut fs: Vec<Face> = Vec::new();
    for i in 0..sides {
        let n = (i + 1) % sides;
        // Top faces
        fs.push([0, 2 + i as u32, 2 + n as u32]);
        // Bottom faces
        fs.push([1, 2 + n as u32, 2 + i as u32]);
    }

    Some((vs, fs))
}

// ── Segment evaluation ───────────────────────────────────────────────

struct Segment {
    steps: usize,
    p0: [f64; 3],
    p1: [f64; 3],
    p2: [f64; 3],
    p3: [f64; 3],
    linear: bool,
    s0: Vec3,
    s1: Vec3,
    r0: Vec3,
    r1: Vec3,
    t1: Vec2,
    t2: Vec2,
    has_transition: bool,
}

fn build_segment(points: &[Point], i: usize, piece: &Piece, resolution: i32) -> Option<Segment> {
    let p0 = vec3(points[i].x, points[i].y, points[i].z);
    let p3 = vec3(points[i + 1].x, points[i + 1].y, points[i + 1].z);

    let co = points[i].curve_out.map(|v| vec3(v.x, v.y, v.z));
    let p1 = co.unwrap_or(p0);
    let ci = points[i + 1].curve_in.map(|v| vec3(v.x, v.y, v.z));
    let p2 = ci.unwrap_or(p3);

    let linear = co.is_none() && ci.is_none();

    // Skip zero-length path segments.
    let mut has_nonzero = false;
    for &t in &[0.0, 0.25, 0.5, 0.75, 1.0] {
        if v_norm(cubic_bezier_deriv(p0, p1, p2, p3, t)) > EPS {
            has_nonzero = true;
            break;
        }
    }
    if !has_nonzero {
        return None;
    }

    let s0 = eff_size(&points[i], piece);
    let s1 = eff_size(&points[i + 1], piece);
    let r0 = eff_rot(&points[i], piece);
    let r1 = eff_rot(&points[i + 1], piece);

    let to = points[i].transition_out;
    let ti = points[i + 1].transition_in;
    let t1 = to.unwrap_or(Vec2 {
        x: 1.0 / 3.0,
        y: 1.0 / 3.0,
    });
    let t2 = ti.unwrap_or(Vec2 {
        x: 2.0 / 3.0,
        y: 2.0 / 3.0,
    });
    let has_transition = to.is_some() || ti.is_some();

    let steps = if linear {
        (resolution / 4).max(1) as usize
    } else {
        resolution as usize
    };

    Some(Segment {
        steps,
        p0,
        p1,
        p2,
        p3,
        linear,
        s0,
        s1,
        r0,
        r1,
        t1,
        t2,
        has_transition,
    })
}

impl Segment {
    fn pos(&self, u: f64) -> [f64; 3] {
        if self.linear {
            v_add(v_scale(self.p0, 1.0 - u), v_scale(self.p3, u))
        } else {
            cubic_bezier(self.p0, self.p1, self.p2, self.p3, u)
        }
    }

    fn tangent(&self, u: f64) -> [f64; 3] {
        if self.linear {
            v_sub(self.p3, self.p0)
        } else {
            let d = cubic_bezier_deriv(self.p0, self.p1, self.p2, self.p3, u);
            if v_norm(d) < EPS {
                for &dt in &[0.01, -0.01, 0.05, -0.05, 0.1, -0.1] {
                    let t = (u + dt).clamp(0.0, 1.0);
                    let d2 = cubic_bezier_deriv(self.p0, self.p1, self.p2, self.p3, t);
                    if v_norm(d2) > EPS {
                        return d2;
                    }
                }
            }
            d
        }
    }

    fn size(&self, u: f64) -> Vec3 {
        let v = if self.has_transition {
            solve_transition(self.t1, self.t2, u)
        } else {
            u
        };
        interpolate_size(self.s0, self.s1, v)
    }

    fn rotation(&self, u: f64) -> Vec3 {
        let v = if self.has_transition {
            solve_transition(self.t1, self.t2, u)
        } else {
            u
        };
        interpolate_rotation(self.r0, self.r1, v)
    }
}

// ── Frame construction ───────────────────────────────────────────────

/// Frame stored as row-major: rows are X, Y, Z components of each axis.
/// Access: frame[row][col] where col=0 is X component, col=1 is Y, col=2 is Z.
type Frame = [[f64; 3]; 3];

fn init_frame(tangent: [f64; 3], r_rot: &[[f64; 3]; 3]) -> Frame {
    let lz = tangent;
    let rx = mat_vec_mul(*r_rot, vec3(1.0, 0.0, 0.0));
    let px = project_onto_plane(rx, lz);

    let lx = if v_norm(px) > 1e-10 {
        normalize(px)
    } else {
        let ry = mat_vec_mul(*r_rot, vec3(0.0, 1.0, 0.0));
        normalize(project_onto_plane(ry, lz))
    };

    // local Y = local Z x local X (right-handed)
    let ly = normalize(v_cross(lz, lx));

    [
        [lx[0], ly[0], lz[0]],
        [lx[1], ly[1], lz[1]],
        [lx[2], ly[2], lz[2]],
    ]
}

fn transport(prev: &Frame, pt: [f64; 3], ct: [f64; 3], r_rot: &[[f64; 3]; 3]) -> Frame {
    let d = v_dot(pt, ct);
    if (d - 1.0).abs() < EPS {
        // Same direction -- just update Z column.
        let mut f = *prev;
        for row in 0..3 {
            f[row][2] = ct[row];
        }
        return f;
    }
    if (d + 1.0).abs() < EPS {
        return init_frame(ct, r_rot);
    }

    let r = minimal_rotation(pt, ct);
    // Apply rotation to X and Y columns of previous frame.
    let lx = normalize(mat_vec_mul(r, [prev[0][0], prev[1][0], prev[2][0]]));
    let ly = normalize(mat_vec_mul(r, [prev[0][1], prev[1][1], prev[2][1]]));

    [
        [lx[0], ly[0], ct[0]],
        [lx[1], ly[1], ct[1]],
        [lx[2], ly[2], ct[2]],
    ]
}

// ── Cross-section vertices at a position ─────────────────────────────

fn cross_section_vertices(
    pos: [f64; 3],
    frame: &Frame,
    size: Vec3,
    _shape: Shape,
    n: usize,
) -> Vec<Vertex> {
    let sx = size.x;
    let sy = size.y;
    // Frame columns: X = col 0, Y = col 1.
    let lx = [frame[0][0], frame[1][0], frame[2][0]];
    let ly = [frame[0][1], frame[1][1], frame[2][1]];

    (0..n)
        .map(|i| {
            let a = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
            v_add(
                pos,
                v_add(v_scale(lx, sx * a.cos()), v_scale(ly, sy * a.sin())),
            )
        })
        .collect()
}

// ── Ring structure for path evaluation ───────────────────────────────

struct Ring {
    pos: [f64; 3],
    frame: Frame,
    size: Vec3,
    verts: Vec<Vertex>,
}

// ── Path-defined tessellation ────────────────────────────────────────

fn tessellate_path_defined(piece: &Piece, resolution: i32) -> Option<Mesh> {
    let cn = cross_n(piece, resolution);

    // Build non-degenerate segments.
    let mut segs: Vec<Segment> = Vec::new();
    for i in 0..piece.points.len() - 1 {
        if let Some(seg) = build_segment(&piece.points, i, piece, resolution) {
            segs.push(seg);
        }
    }

    if segs.is_empty() {
        return None;
    }

    // Evaluate path to generate rings.
    let rings = eval_path(&segs, piece, cn);
    if rings.len() < 2 {
        return None;
    }

    // Collect body vertices and faces.
    let mut verts: Vec<Vertex> = Vec::new();
    for ring in &rings {
        verts.extend_from_slice(&ring.verts);
    }

    let mut faces: Vec<Face> = Vec::new();
    let nr = rings.len();

    for i in 0..(nr - 1) {
        let a0 = i * cn;
        let b0 = (i + 1) * cn;
        for j in 0..cn {
            let jn = (j + 1) % cn;
            faces.push([
                a0 as u32 + j as u32,
                a0 as u32 + jn as u32,
                b0 as u32 + jn as u32,
            ]);
            faces.push([
                a0 as u32 + j as u32,
                b0 as u32 + jn as u32,
                b0 as u32 + j as u32,
            ]);
        }
    }

    // Caps.
    let start_ring = &rings[0];
    let end_ring = &rings[rings.len() - 1];

    for (ring, is_start) in [(start_ring, true), (end_ring, false)] {
        if let Some((cv, cf)) = cap(ring, piece, cn, is_start, resolution) {
            let cv_len = cv.len();
            let off = verts.len();
            verts.extend(cv);

            // Offset face indices to account for new vertices.
            for f in &cf {
                faces.push([f[0] + off as u32, f[1] + off as u32, f[2] + off as u32]);
            }

            // Connect cap base ring to body ring.
            let ring_idx = if is_start { 0 } else { rings.len() - 1 };
            connect_cap(&mut faces, cv_len, off, ring_idx * cn, is_start, cn);
        }
    }

    if faces.is_empty() {
        return None;
    }

    Some((verts, faces))
}

fn eval_path(segs: &[Segment], piece: &Piece, cn: usize) -> Vec<Ring> {
    let mut rings: Vec<Ring> = Vec::new();
    let mut prev_frame: Option<Frame> = None;
    let mut prev_tangent: Option<[f64; 3]> = None;

    for (si, seg) in segs.iter().enumerate() {
        for step in 0..=seg.steps {
            if si > 0 && step == 0 {
                continue; // Skip duplicate at segment boundary.
            }

            let u = step as f64 / seg.steps as f64;
            let p = seg.pos(u);
            let t_raw = seg.tangent(u);
            if v_norm(t_raw) < EPS {
                continue;
            }
            let t = normalize(t_raw);

            let sz = seg.size(u);

            // Check endpoint vs interior degenerate.
            let is_endpoint = (si == 0 && step == 0) || (si == segs.len() - 1 && step == seg.steps);
            if !is_endpoint && is_degenerate(sz.x, sz.y, sz.z) {
                continue;
            }

            let rr = rotation_matrix_xyz(seg.rotation(u).x, seg.rotation(u).y, seg.rotation(u).z);

            let frame = match (&prev_frame, &prev_tangent) {
                (None, _) => init_frame(t, &rr),
                (Some(pf), Some(pt)) => transport(pf, *pt, t, &rr),
                _ => unreachable!(),
            };

            prev_frame = Some(frame);
            prev_tangent = Some(t);

            let rv = cross_section_vertices(p, &frame, sz, piece.shape, cn);
            rings.push(Ring {
                pos: p,
                frame,
                size: sz,
                verts: rv,
            });
        }
    }

    rings
}

// ── Caps ─────────────────────────────────────────────────────────────
/// Build a cap mesh for a path endpoint.
fn cap(ring: &Ring, piece: &Piece, cn: usize, is_start: bool, resolution: i32) -> Option<Mesh> {
    let sz = ring.size.z;
    if sz == 0.0 {
        // Flat cap -- single apex vertex at the ring position.
        // Faces will be generated by connect_cap to fan from apex to body ring.
        return Some((vec![ring.pos], vec![]));
    }

    rounded_cap(ring, piece, cn, is_start, resolution)
}

fn rounded_cap(
    ring: &Ring,
    piece: &Piece,
    cn: usize,
    is_start: bool,
    resolution: i32,
) -> Option<Mesh> {
    let pos = ring.pos;
    // Frame columns.
    let lx = [ring.frame[0][0], ring.frame[1][0], ring.frame[2][0]];
    let ly = [ring.frame[0][1], ring.frame[1][1], ring.frame[2][1]];
    let lz = [ring.frame[0][2], ring.frame[1][2], ring.frame[2][2]];
    let sx = ring.size.x;
    let sy = ring.size.y;
    let sz = ring.size.z;

    let d = if is_start { -1.0 } else { 1.0 };

    match piece.shape {
        Shape::Circle => {
            let nl = (resolution / 4).max(2) as usize;
            let mut vs: Vec<Vertex> = Vec::new();

            // Apex of cap.
            vs.push(v_add(pos, v_scale(lz, d * sz)));

            for i in 1..nl {
                let phi = std::f64::consts::FRAC_PI_2 * i as f64 / nl as f64;
                let sp = phi.sin();
                let cp = phi.cos();
                for j in 0..cn {
                    let a = 2.0 * std::f64::consts::PI * j as f64 / cn as f64;
                    vs.push(v_add(
                        pos,
                        v_add(
                            v_add(
                                v_scale(lx, sx * sp * a.cos()),
                                v_scale(ly, sy * sp * a.sin()),
                            ),
                            v_scale(lz, sz * cp * d),
                        ),
                    ));
                }
            }

            let mut fs: Vec<Face> = Vec::new();

            // Apex to first ring.
            for j in 0..cn {
                let jn = (j + 1) % cn;
                if is_start {
                    fs.push([0, 1 + jn as u32, 1 + j as u32]);
                } else {
                    fs.push([0, 1 + j as u32, 1 + jn as u32]);
                }
            }

            // Middle bands.
            for i in 0..(nl - 2) {
                let a0 = (1 + i * cn) as u32;
                let b0 = (1 + (i + 1) * cn) as u32;
                for j in 0..cn {
                    let jn = ((j + 1) % cn) as u32;
                    if is_start {
                        fs.push([a0 + j as u32, a0 + jn, b0 + jn]);
                        fs.push([a0 + j as u32, b0 + jn, b0 + j as u32]);
                    } else {
                        fs.push([a0 + j as u32, b0 + j as u32, b0 + jn]);
                        fs.push([a0 + j as u32, b0 + jn, a0 + jn]);
                    }
                }
            }

            Some((vs, fs))
        }
        Shape::Ngon => {
            // Ngon half-bipyramid: just the apex.
            Some((vec![v_add(pos, v_scale(lz, d * sz))], vec![]))
        }
    }
}

/// Connect cap vertices to the body ring with fan triangles (flat caps) or quad-split-triangles (rounded caps).
fn connect_cap(
    faces: &mut Vec<Face>,
    cap_verts_count: usize,
    cap_offset: usize,
    ring_base: usize,
    is_start: bool,
    cn: usize,
) {
    if cap_verts_count == 1 {
        // Flat cap: single apex, fan to body ring.
        let apex = cap_offset as u32;
        for j in 0..cn {
            let a = (ring_base + j) as u32;
            let b = (ring_base + ((j + 1) % cn)) as u32;
            if is_start {
                faces.push([apex, b, a]);
            } else {
                faces.push([apex, a, b]);
            }
        }
    } else {
        // Rounded cap: connect last cap ring to body ring with quad-split-triangles.
        let nl = (cap_verts_count - 1) / cn + 1; // number of latitude divisions
        let last_ring_start = cap_offset + 1 + (nl - 2) * cn;
        for j in 0..cn {
            let jn = (j + 1) % cn;
            let a = (last_ring_start + j) as u32;
            let b = (ring_base + j) as u32;
            let an = (last_ring_start + jn) as u32;
            let bn = (ring_base + jn) as u32;
            if is_start {
                faces.push([a, an, bn]);
                faces.push([a, bn, b]);
            } else {
                faces.push([a, b, bn]);
                faces.push([a, bn, an]);
            }
        }
    }
}
