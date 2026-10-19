//! Lado nativo de Planificador Jira.
//!
//! Además de lo que trae Planificador simple (abrir archivos con el sistema), aquí viven:
//! - las credenciales de Jira, guardadas en el llavero del sistema operativo
//!   (Llavero en Mac, Administrador de credenciales en Windows), nunca en el `.planif`;
//! - las llamadas a la API REST de Jira Cloud, hechas desde Rust para que el token
//!   no pase por la vista web.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Servicio con el que se registran las credenciales en el llavero.
const KEYRING_SERVICE: &str = "cl.planificador.jira";
const KEYRING_USER: &str = "jira-cloud";

#[derive(Serialize, Deserialize, Clone)]
struct Credentials {
    /// URL del sitio, por ejemplo `https://miempresa.atlassian.net` (sin barra final).
    site: String,
    /// Correo de la cuenta de Atlassian.
    email: String,
    /// Token de API de Atlassian.
    token: String,
}

/// Lo que la interfaz puede ver de las credenciales guardadas: nunca el token.
#[derive(Serialize)]
pub struct StoredAccount {
    site: String,
    email: String,
}

/// Respuesta de una llamada a Jira: código HTTP y cuerpo (JSON si lo hay).
#[derive(Serialize)]
pub struct JiraResponse {
    status: u16,
    body: Value,
}

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("No se pudo acceder al llavero: {e}"))
}

fn normalize_site(site: &str) -> String {
    let s = site.trim().trim_end_matches('/');
    if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("https://{s}")
    }
}

fn load_credentials() -> Result<Option<Credentials>, String> {
    match entry()?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Credenciales guardadas ilegibles: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("No se pudieron leer las credenciales: {e}")),
    }
}

async fn call(
    creds: &Credentials,
    method: &str,
    path: &str,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<JiraResponse, String> {
    let url = format!("{}{}", creds.site, path);
    let client = reqwest::Client::builder()
        .user_agent("PlanificadorJira")
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client
        .request(method, &url)
        .basic_auth(&creds.email, Some(&creds.token))
        .header("Accept", "application/json");
    if let Some(q) = query {
        req = req.query(&q);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| format!("No se pudo conectar con Jira: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    Ok(JiraResponse { status, body })
}

/// Prueba unas credenciales contra Jira (GET /rest/api/3/myself) y, si son válidas, las guarda
/// en el llavero. Devuelve el nombre de la cuenta.
#[tauri::command]
async fn jira_connect(site: String, email: String, token: String) -> Result<Value, String> {
    let creds = Credentials {
        site: normalize_site(&site),
        email: email.trim().to_string(),
        token: token.trim().to_string(),
    };
    let res = call(&creds, "GET", "/rest/api/3/myself", None, None).await?;
    match res.status {
        200 => {}
        401 => return Err("Jira rechazó el correo o el token (401).".into()),
        403 => return Err("La cuenta no tiene permiso para usar la API de Jira (403).".into()),
        404 => return Err("No se encontró un sitio de Jira en esa dirección (404).".into()),
        s => return Err(format!("Jira respondió con el código {s}.")),
    }
    let raw = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&raw)
        .map_err(|e| format!("No se pudieron guardar las credenciales en el llavero: {e}"))?;
    Ok(res.body)
}

/// Cuenta guardada (sitio y correo), o null si no hay ninguna.
#[tauri::command]
fn jira_stored_account() -> Result<Option<StoredAccount>, String> {
    Ok(load_credentials()?.map(|c| StoredAccount { site: c.site, email: c.email }))
}

/// Borra las credenciales del llavero.
#[tauri::command]
fn jira_forget() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("No se pudieron borrar las credenciales: {e}")),
    }
}

/// Llamada genérica a la API REST de Jira con las credenciales guardadas.
/// `path` es la ruta completa dentro del sitio, por ejemplo `/rest/api/3/project/search`.
#[tauri::command]
async fn jira_request(
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<JiraResponse, String> {
    let creds = load_credentials()?.ok_or("No hay una conexión con Jira configurada.")?;
    if !path.starts_with("/rest/") {
        return Err("Ruta de Jira no permitida.".into());
    }
    call(&creds, &method, &path, query, body).await
}

/// Abre un archivo con la aplicación predeterminada (el navegador para los informes HTML).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_path,
            jira_connect,
            jira_stored_account,
            jira_forget,
            jira_request
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Planificador Jira");
}
