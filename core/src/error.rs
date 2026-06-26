/// Errors produced by ssk-core operations.
use std::fmt;

#[derive(Debug)]
pub enum SskError {
    /// Invalid input data (missing fields, bad values, etc.).
    InvalidInput(String),
    /// Tessellation failure.
    TessellationFailed(String),
    /// Boolean/CSG operation failure from manifold.
    CsgFailure(String),
}

impl fmt::Display for SskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(msg) => write!(f, "invalid input: {msg}"),
            Self::TessellationFailed(msg) => write!(f, "tessellation failed: {msg}"),
            Self::CsgFailure(e) => write!(f, "CSG failure: {e}"),
        }
    }
}

impl std::error::Error for SskError {}

impl From<manifold_csg::CsgError> for SskError {
    fn from(e: manifold_csg::CsgError) -> Self {
        Self::CsgFailure(e.to_string())
    }
}
