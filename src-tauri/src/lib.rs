//! Envoltorio de escritorio de AutoFirma Web: la misma SPA estática dentro de la webview del
//! sistema (WebView2 en Windows, WKWebView en macOS). Toda la criptografía sigue en el frontend;
//! el lado nativo solo aporta el diálogo "Guardar como", porque una webview no descarga ficheros
//! con `<a download>` como lo hace un navegador.

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Guarda los bytes de una firma donde elija el usuario. Los bytes llegan en crudo (sin pasar por
/// JSON) y el nombre propuesto en la cabecera `x-file-name`, codificado como URI.
/// Devuelve `false` si el usuario cancela el diálogo.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("se esperaban los bytes del fichero".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode_str(value).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "firma".into());

    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar AutoFirma Web");
}
