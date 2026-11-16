// Shell desktop do nerd-watch.
//
// O cliente vai embutido (`frontendDist`), como no canto-widget: a janela abre em
// `tauri://localhost/index.html` e não existe página servida por HTTP. As chamadas `/api/*` do
// cliente são interceptadas e viram IPC (`api_request`) para um worker Bun por stdin/stdout.
// Só o streaming de bytes (vídeo, torrent, legenda) usa um loopback interno, porque `<video>` e
// `Range` não cabem no protocolo de IPC.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

/// O sidecar compilado pelo Bun é um executável de console; sem esta flag o Windows abre uma
/// janela de terminal junto com o app. Os pipes de stdin/stdout continuam valendo.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Resposta de `/api/*` vinda do worker.
#[derive(serde::Deserialize, serde::Serialize)]
struct Reply {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// Processo Bun que responde pelo app. Vive enquanto a janela viver.
struct Worker {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    next_id: AtomicU64,
    media_base: String,
    child: Mutex<Option<Child>>,
}

impl Worker {
    /// Sobe o sidecar (instalado) ou `bun src/server/worker.ts` (dev) e espera o `ready`.
    fn spawn() -> Result<Worker, String> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .ok_or_else(|| "não achei a pasta do executável".to_string())?;
        let sidecar = exe_dir.join("nerd-watch-server.exe");
        let dev_dir = std::env::var_os("NERD_WATCH_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .map(Path::to_path_buf)
            });

        let mut command = if sidecar.exists() {
            let mut cmd = Command::new(&sidecar);
            cmd.current_dir(&exe_dir);
            cmd
        } else {
            let dir = dev_dir
                .filter(|dir| dir.join("package.json").exists())
                .ok_or_else(|| {
                    "não achei o servidor: instale o app ou defina NERD_WATCH_DIR".to_string()
                })?;
            let mut cmd = Command::new("bun");
            cmd.arg("src/server/worker.ts").current_dir(&dir);
            cmd
        };

        let log = open_log(&exe_dir);
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        match &log {
            Some(file) => {
                command.stderr(Stdio::from(file.try_clone().map_err(|e| e.to_string())?));
            }
            None => {
                command.stderr(Stdio::null());
            }
        }

        let mut child = command
            .spawn()
            .map_err(|err| format!("não consegui iniciar o servidor ({err})"))?;
        let stdin = child.stdin.take().ok_or("sem stdin do worker")?;
        let stdout = child.stdout.take().ok_or("sem stdout do worker")?;

        let pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>> = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = Arc::clone(&pending);
        let (ready_tx, ready_rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut ready_sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value.get("type").and_then(|t| t.as_str()) == Some("ready") {
                        let base = value
                            .get("mediaBase")
                            .and_then(|b| b.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let _ = ready_tx.send(base);
                        ready_sent = true;
                        continue;
                    }
                    if let Some(id) = value.get("id").and_then(|id| id.as_u64()) {
                        if let Ok(reply) = serde_json::from_value::<Reply>(value) {
                            if let Some(tx) = pending_reader
                                .lock()
                                .ok()
                                .and_then(|mut map| map.remove(&id))
                            {
                                let _ = tx.send(reply);
                            }
                        }
                    }
                }
            }
            if !ready_sent {
                let _ = ready_tx.send(String::new());
            }
        });

        let media_base = ready_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "o servidor embutido não respondeu em 30s".to_string())?;
        if media_base.is_empty() {
            let _ = child.kill();
            return Err("o servidor embutido subiu sem endereço de mídia".to_string());
        }

        Ok(Worker {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            media_base,
            child: Mutex::new(Some(child)),
        })
    }

    fn call(
        &self,
        method: &str,
        path: &str,
        headers: HashMap<String, String>,
        body: Option<String>,
    ) -> Result<Reply, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, tx);

        let message = serde_json::json!({ "id": id, "method": method, "path": path, "headers": headers, "body": body });
        {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            writeln!(stdin, "{message}")
                .map_err(|err| format!("worker fechou a entrada: {err}"))?;
            stdin.flush().map_err(|err| err.to_string())?;
        }

        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "o servidor embutido não respondeu".to_string())
    }

    fn stop(&self) {
        if let Some(mut child) = self.child.lock().ok().and_then(|mut c| c.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct WorkerState(Arc<Worker>);

#[tauri::command]
async fn api_request(
    state: State<'_, WorkerState>,
    method: String,
    path: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<Reply, String> {
    let worker = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        worker.call(&method, &path, headers.unwrap_or_default(), body)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Abre no navegador do sistema. Só http(s): nada de `file://` ou esquema arbitrário.
fn open_in_browser(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("só links http(s) abrem no navegador".to_string());
    }
    #[cfg(target_os = "windows")]
    let spawned = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(url).spawn();
    spawned.map(|_| ()).map_err(|err| err.to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    open_in_browser(&url)
}

fn open_log(dir: &Path) -> Option<File> {
    let path = dir.join(".cache").join("desktop.log");
    std::fs::create_dir_all(path.parent()?).ok()?;
    OpenOptions::new().create(true).append(true).open(path).ok()
}

/// Atualização achada e ainda não instalada. Fica no estado do Tauri entre `check_update` e `install_update`.
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Consulta o `latest.json` da última release. `None` = já está na versão mais nova. A instalação só
/// acontece quando a pessoa pede (`install_update`): nunca reinicia o app sem aviso.
#[tauri::command]
async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|err| err.to_string())?;
    let found = updater.check().await.map_err(|err| err.to_string())?;
    let info = found.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone(),
    });
    *pending.0.lock().map_err(|err| err.to_string())? = found;
    Ok(info)
}

/// Baixa (verificando a assinatura da `pubkey`), instala e reinicia. O progresso vai para a UI pelo
/// evento `update-progress` ({ downloaded, total }), para a pessoa ver a atualização andando.
#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .take()
        .ok_or_else(|| "nenhuma atualização pendente".to_string())?;
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;
    app.restart()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![api_request, open_external, check_update, install_update])
        .setup(|app| {
            let worker =
                Worker::spawn().map_err(|err| format!("erro ao iniciar o nerd-watch: {err}"))?;
            let media_base =
                serde_json::to_string(&worker.media_base).unwrap_or_else(|_| "\"\"".to_string());
            app.manage(WorkerState(Arc::new(worker)));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("nerd-watch")
                .inner_size(1280.0, 860.0)
                .min_inner_size(960.0, 620.0)
                .initialization_script(format!("window.__NERD_WATCH_MEDIA_BASE__ = {media_base};"))
                // Link externo (trailer, streaming, embed) abre no navegador, nunca dentro da janela.
                .on_navigation(|url| {
                    let host = url.host_str().unwrap_or_default();
                    if url.scheme() == "tauri" || host == "tauri.localhost" {
                        return true;
                    }
                    let _ = open_in_browser(url.as_str());
                    false
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o nerd-watch")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app.try_state::<WorkerState>() {
                    state.0.stop();
                }
            }
        });
}
