//! Low-level SolidSKeleton tessellation and CSG engine.
//!
//! # Design
//!
//! - Input: resolved SolidSKeleton document data and a resolution value.
//! - Output: raw vertices and triangle face indices.
//! - No file I/O or export formatting.
//! - Uses [manifold-csg](https://github.com/zmerlynn/manifold-csg) for boolean CSG.
//!
//! # Quick start
//!
//! ```ignore
//! use ssk_core::{Document, TessellationConfig};
//!
//! let doc = Document { pieces: vec![/* ... */] };
//! let config = TessellationConfig::new(64);
//! let (verts, faces) = ssk_core::process(&doc, &config)?;
//! // verts: Vec<[f64; 3]> -- positions in millimeters
//! // faces: Vec<[u32; 3]> -- triangle face indices
//! ```

pub mod boolean;
pub mod error;
pub mod resolve;
pub mod ssk;
pub mod tessellate;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod deep_tests;

use std::collections::HashMap;

pub use error::SskError;
pub use ssk::{Document, Piece};
use serde::{Deserialize, Serialize};

#[cfg(feature = "python")]
use pyo3::prelude::*;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

const MIN_RESOLUTION: i32 = 3;

/// Raw vertex position in millimeters.
pub type Vertex = [f64; 3];

/// Raw triangle face indices.
pub type Face = [u32; 3];

/// Raw output mesh: vertices plus triangle face indices.
pub type Mesh = (Vec<Vertex>, Vec<Face>);

#[derive(Deserialize)]
struct Request {
    document: Document,
    resolution: i32,
}

#[derive(Serialize)]
struct Response {
    vertices: Vec<Vertex>,
    faces: Vec<Face>,
}

/// Tessellation configuration.
#[derive(Debug, Clone)]
pub struct TessellationConfig {
    /// Number of segments per cross-section and curve subdivision depth.
    pub resolution: i32,
}

impl TessellationConfig {
    /// Create a new config with the given resolution.
    ///
    /// Minimum resolution is 3 (fewer produces degenerate geometry).
    pub fn new(resolution: i32) -> Self {
        Self { resolution }
    }
}

/// Process a resolved SolidSKeleton document into a final mesh.
///
/// The document is validated before tessellation and boolean evaluation.
/// Returns raw vertices (f64, millimeters) and triangle face indices (u32).
pub fn process(doc: &Document, config: &TessellationConfig) -> Result<Mesh, SskError> {
    if config.resolution < MIN_RESOLUTION {
        return Err(SskError::InvalidInput(format!(
            "resolution must be >= {MIN_RESOLUTION}"
        )));
    }

    doc.validate()?;

    let mut meshes: HashMap<i64, Mesh> = HashMap::new();
    for piece in &doc.pieces {
        if let Some(mesh) = tessellate::tessellate_piece(piece, config.resolution) {
            meshes.insert(piece.id, mesh);
        }
    }

    boolean::evaluate(&doc.pieces, &meshes)
}

/// Process a JSON request into a JSON mesh response.
pub fn process_json(input: &str) -> Result<String, SskError> {
    let request: Request = serde_json::from_str(input)
        .map_err(|error| SskError::InvalidInput(format!("invalid request JSON: {error}")))?;
    let (vertices, faces) = process(
        &request.document,
        &TessellationConfig::new(request.resolution),
    )?;
    serde_json::to_string(&Response { vertices, faces })
        .map_err(|error| SskError::InvalidInput(format!("failed to encode response JSON: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn mesh_document_json(input: &str) -> Result<String, JsValue> {
    process_json(input).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(feature = "python")]
#[pyfunction]
fn mesh_document_json(input: &str) -> PyResult<String> {
    process_json(input).map_err(|error| pyo3::exceptions::PyRuntimeError::new_err(error.to_string()))
}

#[cfg(feature = "python")]
#[pymodule]
fn _core(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(mesh_document_json, module)?)?;
    Ok(())
}
