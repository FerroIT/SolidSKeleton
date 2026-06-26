/// Piece inheritance resolution.
///
/// Resolves `from` references so every piece has all required fields populated.
use crate::error::SskError;
use crate::ssk::{Mode, Piece, Point, Shape, Vec3};

/// Raw un-resolved piece with optional `from` field.
#[derive(Debug, Clone)]
pub struct RawPiece {
    pub id: i64,
    pub from: Option<i64>,
    pub points: Option<Vec<Point>>,
    pub size: Option<Vec3>,
    pub shape: Option<Shape>,
    pub sides: Option<i64>,
    pub rotation: Option<Vec3>,
    pub mode: Option<Mode>,
    pub affects: Option<Vec<i64>>,
}

/// Resolve all `from` references in a document's pieces.
///
/// Returns the resolved pieces sorted by ascending ID.
pub fn resolve(pieces: Vec<RawPiece>) -> Result<Vec<Piece>, SskError> {
    // Check IDs are unique.
    let ids: Vec<i64> = pieces.iter().map(|p| p.id).collect();
    if ids.len()
        != ids
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>()
            .len()
    {
        return Err(SskError::InvalidInput(
            "piece IDs must be unique before inheritance resolution".into(),
        ));
    }

    let by_id: std::collections::HashMap<i64, RawPiece> =
        pieces.into_iter().map(|p| (p.id, p)).collect();

    // Check inheritance graph for cycles and validity.
    check_inheritance_graph(&by_id)?;

    let mut done = std::collections::HashSet::new();
    let mut resolved: Vec<Piece> = Vec::new();

    for &pid in &ids {
        if !done.contains(&pid) {
            resolve_piece(pid, &by_id, &mut done, &mut resolved)?;
        }
    }

    // Keep boolean processing deterministic.
    resolved.sort_by_key(|p| p.id);
    Ok(resolved)
}

fn check_inheritance_graph(
    by_id: &std::collections::HashMap<i64, RawPiece>,
) -> Result<(), SskError> {
    let mut visiting = std::collections::HashSet::new();
    let mut visited = std::collections::HashSet::new();

    fn visit(
        pid: i64,
        by_id: &std::collections::HashMap<i64, RawPiece>,
        visiting: &mut std::collections::HashSet<i64>,
        visited: &mut std::collections::HashSet<i64>,
    ) -> Result<(), SskError> {
        if visited.contains(&pid) {
            return Ok(());
        }
        if visiting.contains(&pid) {
            return Err(SskError::InvalidInput(format!(
                "circular inheritance involving piece {pid}"
            )));
        }
        visiting.insert(pid);

        let piece = by_id
            .get(&pid)
            .ok_or_else(|| SskError::InvalidInput(format!("piece {pid} not found")))?;

        if let Some(fid) = piece.from {
            if fid == pid {
                return Err(SskError::InvalidInput(format!(
                    "piece {pid}: self-reference is invalid"
                )));
            }
            if fid > pid {
                return Err(SskError::InvalidInput(format!(
                    "piece {pid}: from must reference a lower ID"
                )));
            }
            if !by_id.contains_key(&fid) {
                return Err(SskError::InvalidInput(format!(
                    "piece {pid}: from references non-existent piece {fid}"
                )));
            }
            visit(fid, by_id, visiting, visited)?;
        }

        visiting.remove(&pid);
        visited.insert(pid);
        Ok(())
    }

    let pids: Vec<i64> = by_id.keys().cloned().collect();
    for &pid in &pids {
        visit(pid, by_id, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn resolve_piece(
    pid: i64,
    by_id: &std::collections::HashMap<i64, RawPiece>,
    done: &mut std::collections::HashSet<i64>,
    resolved: &mut Vec<Piece>,
) -> Result<(), SskError> {
    if done.contains(&pid) {
        return Ok(());
    }

    let piece = by_id
        .get(&pid)
        .ok_or_else(|| SskError::InvalidInput(format!("piece {pid} not found")))?;

    // Resolve parent first.
    if let Some(fid) = piece.from {
        if !done.contains(&fid) {
            resolve_piece(fid, by_id, done, resolved)?;
        }
    }

    // Build resolved piece from the already-resolved parent. This is required
    // for reference chains, because a raw parent may itself omit inherited
    // fields.
    let src = piece
        .from
        .and_then(|fid| resolved.iter().find(|p| p.id == fid));

    let points = piece
        .points
        .clone()
        .or_else(|| src.map(|s| s.points.clone()))
        .ok_or_else(|| SskError::InvalidInput(format!("piece {}: missing points", pid)))?;

    let size = piece
        .size
        .or_else(|| src.map(|s| s.size))
        .ok_or_else(|| SskError::InvalidInput(format!("piece {}: missing size", pid)))?;

    let shape = piece
        .shape
        .or_else(|| src.map(|s| s.shape))
        .ok_or_else(|| SskError::InvalidInput(format!("piece {}: missing shape", pid)))?;

    let resolved_piece = Piece {
        id: pid,
        points,
        size,
        shape,
        sides: piece.sides.or_else(|| src.and_then(|s| s.sides)),
        rotation: piece.rotation.or_else(|| src.and_then(|s| s.rotation)),
        mode: piece
            .mode
            .or_else(|| src.map(|s| s.mode))
            .unwrap_or(Mode::Add),
        affects: piece
            .affects
            .clone()
            .or_else(|| src.and_then(|s| s.affects.clone())),
    };

    done.insert(pid);
    resolved.push(resolved_piece);
    Ok(())
}
