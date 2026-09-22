use std::sync::Arc;

use axum::extract::FromRef;

use crate::storage::NativeStorage;

/// Shared server state.
///
/// `FromRef` lets the ported storage handlers keep extracting exactly the state
/// they need (`State<Arc<NativeStorage>>`) without a wrapper layer, so the
/// migration stayed a signature change rather than a rewrite.
#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<NativeStorage>,
}

impl FromRef<AppState> for Arc<NativeStorage> {
    fn from_ref(state: &AppState) -> Self {
        state.storage.clone()
    }
}
