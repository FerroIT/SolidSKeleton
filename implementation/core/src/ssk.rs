/// SolidSKeleton data model types.
///
/// These are resolved document structures. File parsing and serialization live outside this crate.
use std::collections::HashSet;

use crate::error::SskError;
use serde::{Deserialize, Serialize};

/// A 3D vector in millimeters.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// A 2D vector for transition controls.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

/// Cross-section shape.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    /// Smooth cross-section (circle path / ellipsoid point).
    Circle,
    /// Regular polygon with `sides` sides (ngon path / bipyramid point).
    Ngon,
}

/// Boolean mode for a piece. Defaults to Add if omitted.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Add,
    Subtract,
    Intersect,
}

/// A single point on a piece's path or at its center (point-defined).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Bezier curve control handle pointing away from this point.
    pub curve_out: Option<Vec3>,
    /// Bezier curve control handle pointing toward this point.
    pub curve_in: Option<Vec3>,
    /// Per-point size override (radii).
    pub size: Option<Vec3>,
    /// Per-point rotation override (XYZ Euler, degrees).
    pub rotation: Option<Vec3>,
    /// Transition control for outgoing segment interpolation.
    pub transition_out: Option<Vec2>,
    /// Transition control for incoming segment interpolation.
    pub transition_in: Option<Vec2>,
}

/// A resolved piece -- inheritance already applied, all fields present.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Piece {
    pub id: i64,
    pub points: Vec<Point>,
    /// Piece-level size (radii). Used when point has no override.
    pub size: Vec3,
    /// Cross-section shape.
    pub shape: Shape,
    /// Number of sides for Ngon shapes. Required if shape is Ngon.
    pub sides: Option<i64>,
    /// Piece-level rotation (XYZ Euler, degrees). Used when point has no override.
    pub rotation: Option<Vec3>,
    /// Boolean mode. Defaults to Add.
    pub mode: Mode,
    /// Limits which pieces this piece may boolean against.
    pub affects: Option<Vec<i64>>,
}

/// A complete SolidSKeleton document after parsing and inheritance resolution.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Document {
    pub pieces: Vec<Piece>,
}

impl Document {
    /// Validate a resolved document.
    pub fn validate(&self) -> Result<(), SskError> {
        // Check IDs are unique, start at 0, contiguous.
        if self.pieces.is_empty() {
            return Ok(());
        }

        let mut seen = HashSet::new();
        for piece in &self.pieces {
            if !seen.insert(piece.id) {
                return Err(SskError::InvalidInput("piece IDs must be unique".into()));
            }
        }

        let mut ids: Vec<i64> = self.pieces.iter().map(|p| p.id).collect();
        ids.sort();

        if ids[0] != 0 {
            return Err(SskError::InvalidInput("piece IDs must start at 0".into()));
        }

        for i in 1..ids.len() {
            if ids[i] != ids[i - 1] + 1 {
                return Err(SskError::InvalidInput(
                    "piece IDs must be contiguous".into(),
                ));
            }
        }

        for piece in &self.pieces {
            piece.validate(&ids)?;
        }

        Ok(())
    }
}

impl Piece {
    /// Validate a single resolved piece.
    pub fn validate(&self, valid_ids: &[i64]) -> Result<(), SskError> {
        if self.points.is_empty() {
            return Err(SskError::InvalidInput(format!(
                "piece {}: must have at least one point",
                self.id
            )));
        }

        match self.shape {
            Shape::Ngon => {
                let sides = self.sides.unwrap_or(0);
                if sides < 3 {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: ngon requires sides >= 3, got {}",
                        self.id, sides
                    )));
                }
            }
            Shape::Circle => {}
        }

        // Validate size values are non-negative and finite.
        if !self.size.x.is_finite() || !self.size.y.is_finite() || !self.size.z.is_finite() {
            return Err(SskError::InvalidInput(format!(
                "piece {}: size must be finite",
                self.id
            )));
        }
        if self.size.x < 0.0 || self.size.y < 0.0 || self.size.z < 0.0 {
            return Err(SskError::InvalidInput(format!(
                "piece {}: size must be non-negative",
                self.id
            )));
        }

        for (idx, pt) in self.points.iter().enumerate() {
            if !pt.x.is_finite() || !pt.y.is_finite() || !pt.z.is_finite() {
                return Err(SskError::InvalidInput(format!(
                    "piece {}: point {} coordinates must be finite",
                    self.id, idx
                )));
            }

            if let Some(c) = &pt.curve_in {
                if !c.x.is_finite() || !c.y.is_finite() || !c.z.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} curve_in must be finite",
                        self.id, idx
                    )));
                }
            }

            if let Some(c) = &pt.curve_out {
                if !c.x.is_finite() || !c.y.is_finite() || !c.z.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} curve_out must be finite",
                        self.id, idx
                    )));
                }
            }

            if let Some(s) = &pt.size {
                if !s.x.is_finite() || !s.y.is_finite() || !s.z.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} size must be finite",
                        self.id, idx
                    )));
                }
                if s.x < 0.0 || s.y < 0.0 || s.z < 0.0 {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} size must be non-negative",
                        self.id, idx
                    )));
                }
            }

            if let Some(r) = &pt.rotation {
                if !r.x.is_finite() || !r.y.is_finite() || !r.z.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} rotation must be finite",
                        self.id, idx
                    )));
                }
            }

            if let Some(t) = &pt.transition_in {
                if !t.x.is_finite() || !t.y.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} transition_in must be finite",
                        self.id, idx
                    )));
                }
                if t.x < 0.0 || t.x > 1.0 {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} transition_in x must be in [0,1]",
                        self.id, idx
                    )));
                }
            }

            if let Some(t) = &pt.transition_out {
                if !t.x.is_finite() || !t.y.is_finite() {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} transition_out must be finite",
                        self.id, idx
                    )));
                }
                if t.x < 0.0 || t.x > 1.0 {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: point {} transition_out x must be in [0,1]",
                        self.id, idx
                    )));
                }
            }
        }

        for i in 0..self.points.len().saturating_sub(1) {
            let t1x = self.points[i]
                .transition_out
                .map(|v| v.x)
                .unwrap_or(1.0 / 3.0);
            let t2x = self.points[i + 1]
                .transition_in
                .map(|v| v.x)
                .unwrap_or(2.0 / 3.0);

            if !(0.0 <= t1x && t1x <= t2x && t2x <= 1.0) {
                return Err(SskError::InvalidInput(format!(
                    "piece {}: segment {} transition not monotone in x",
                    self.id, i
                )));
            }
        }

        if let Some(affects) = &self.affects {
            let valid: HashSet<i64> = valid_ids.iter().copied().collect();
            let mut seen = HashSet::new();
            for &aid in affects {
                if !valid.contains(&aid) {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: affects references non-existent piece {}",
                        self.id, aid
                    )));
                }
                if aid == self.id {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: cannot affect itself",
                        self.id
                    )));
                }
                if !seen.insert(aid) {
                    return Err(SskError::InvalidInput(format!(
                        "piece {}: duplicate id {} in affects",
                        self.id, aid
                    )));
                }
            }
        }

        Ok(())
    }

    /// Is this piece path-defined (>1 point) or point-defined (==1 point)?
    pub fn is_path_defined(&self) -> bool {
        self.points.len() > 1
    }
}
