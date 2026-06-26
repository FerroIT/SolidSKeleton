/// Boolean evaluation for tessellated pieces.
use crate::error::SskError;
use crate::ssk::{Mode, Piece};
use crate::{Face, Mesh, Vertex};
use manifold_csg::Manifold;

/// Evaluate all boolean operations on a document's tessellated meshes.
///
/// Returns the final combined mesh, or an empty mesh if everything cancelled out.
pub fn evaluate(
    pieces: &[Piece],
    meshes: &std::collections::HashMap<i64, Mesh>,
) -> Result<Mesh, SskError> {
    // Use document order by ascending piece ID.
    let mut sorted_pieces = pieces.to_vec();
    sorted_pieces.sort_by_key(|p| p.id);

    // Build active manifolds from tessellated meshes.
    let mut active: std::collections::HashMap<i64, Manifold> = std::collections::HashMap::new();
    for piece in &sorted_pieces {
        let pid = piece.id;
        if let Some((verts, faces)) = meshes.get(&pid) {
            if verts.is_empty() || faces.is_empty() {
                continue;
            }

            let vert_props: Vec<f64> = verts.iter().flat_map(|v| [v[0], v[1], v[2]]).collect();
            let tri_indices: Vec<u64> = faces
                .iter()
                .flat_map(|f| [f[0] as u64, f[1] as u64, f[2] as u64])
                .collect();

            let manifold = Manifold::from_mesh_f64(&vert_props, 3, &tri_indices).map_err(|e| {
                SskError::CsgFailure(format!("piece {pid}: manifold mesh creation failed: {e}"))
            })?;
            active.insert(pid, manifold);
        }
    }

    if active.is_empty() {
        return Ok((vec![], vec![]));
    }

    let mode_of: std::collections::HashMap<i64, Mode> = sorted_pieces
        .iter()
        .filter(|p| active.contains_key(&p.id))
        .map(|p| (p.id, p.mode))
        .collect();

    // Add phase: add pieces contribute their full candidate volume.
    let mut contrib: std::collections::HashMap<i64, Manifold> = std::collections::HashMap::new();
    for piece in &sorted_pieces {
        let pid = piece.id;
        if active.contains_key(&pid) && mode_of.get(&pid) == Some(&Mode::Add) {
            contrib.insert(pid, active[&pid].clone());
        }
    }

    // Add phase: intersect pieces contribute overlap with allowed add/intersect candidates.
    for piece in &sorted_pieces {
        let pid = piece.id;
        if !active.contains_key(&pid) || mode_of.get(&pid) != Some(&Mode::Intersect) {
            continue;
        }

        let affects = piece.affects.as_ref();
        let targets: Vec<(i64, &Manifold)> = sorted_pieces
            .iter()
            .filter(|o| o.id != pid && active.contains_key(&o.id))
            .filter(|o| {
                mode_of.get(&o.id) == Some(&Mode::Add)
                    || mode_of.get(&o.id) == Some(&Mode::Intersect)
            })
            .filter(|o| affects.is_none() || affects.is_some_and(|a| a.contains(&o.id)))
            .map(|o| (o.id, &active[&o.id]))
            .collect();

        if targets.is_empty() {
            continue;
        }

        let mut union = targets[0].1.clone();
        for (_, target) in &targets[1..] {
            union = (&union + target).clone();
        }

        let result = &active[&pid] ^ &union;
        if result.num_tri() > 0 {
            contrib.insert(pid, result);
        }
    }

    if contrib.is_empty() {
        return Ok((vec![], vec![]));
    }

    // Subtract phase.
    for piece in &sorted_pieces {
        let pid = piece.id;
        if !active.contains_key(&pid) || mode_of.get(&pid) != Some(&Mode::Subtract) {
            continue;
        }

        let affects = piece.affects.as_ref();
        for cid in contrib.keys().cloned().collect::<Vec<_>>() {
            if affects.is_some_and(|a| !a.contains(&cid)) {
                continue;
            }

            let result = &contrib[&cid] - &active[&pid];
            if result.num_tri() > 0 {
                contrib.insert(cid, result);
            } else {
                contrib.remove(&cid);
            }
        }
    }

    if contrib.is_empty() {
        return Ok((vec![], vec![]));
    }

    let mut ids: Vec<i64> = contrib.keys().cloned().collect();
    ids.sort();
    let mut result = contrib[&ids[0]].clone();
    for &cid in &ids[1..] {
        result = (&result + &contrib[&cid]).clone();
    }

    let (vert_props, _n_props, tri_indices) = result.to_mesh_f64();

    let verts: Vec<Vertex> = vert_props
        .chunks_exact(3)
        .map(|c| [c[0], c[1], c[2]])
        .collect();

    let faces: Vec<Face> = tri_indices
        .chunks_exact(3)
        .map(|c| [c[0] as u32, c[1] as u32, c[2] as u32])
        .collect();

    Ok((verts, faces))
}
