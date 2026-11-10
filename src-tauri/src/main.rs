// Shell desktop do nerd-watch: o app continua sendo o servidor Bun/Hono local.
// Esta camada só sobe `bun src/server/index.ts`, espera o /api/health e aponta a janela
// nativa (WebView2) para o loopback. Assim o front, o SQLite e os providers não mudam.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

/// Handle do servidor Bun para derrubar no exit (sem isso, fechar a janela deixa o processo vivo).
struct ServerProcess(Mutex<Option<Child>>);

/// Onde o servidor roda. `bundled` distingue a versão instalada (recursos em `_up_/`) do dev.
struct AppDir {
    dir: PathBuf,
    bundled: bool,
}

/// Pasta do projeto (onde está o package.json). Ordem: `NERD_WATCH_DIR` > app embarcado na
/// instalação > caminho do build (dev). O app embarcado é o que faz a versão instalada pelo
/// instalador e pelo auto-update achar o servidor sem depender do repositório.
fn app_dir(app: &AppHandle) -> Option<AppDir> {
    if let Some(dir) = std::env::var_os("NERD_WATCH_DIR") {
        return Some(AppDir { dir: PathBuf::from(dir), bundled: false });
    }
    if let Ok(resources) = app.path().resource_dir() {
        // Tauri copia caminhos fora de `src-tauri/` para `_up_/`; os dois layouts são aceitos.
        for candidate in [resources.clone(), resources.join("_up_")] {
            if candidate.join("package.json").exists() && candidate.join("src").join("server").is_dir() {
                return Some(AppDir { dir: candidate, bundled: true });
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    Some(AppDir { dir: dev, bundled: false }).filter(|app| app.dir.join("package.json").exists())
}

fn preferred_port() -> u16 {
    std::env::var("NERD_WATCH_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(7799)
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Porta livre: se a preferida estiver ocupada (outra instância, outro app), o SO escolhe uma.
fn pick_port(preferred: u16) -> u16 {
    if port_free(preferred) {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .unwrap_or(preferred)
}

fn wait_health(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn open_log(dir: &Path) -> Option<File> {
    let path = dir.join(".cache").join("desktop.log");
    std::fs::create_dir_all(path.parent()?).ok()?;
    File::create(path).ok()
}

/// Primeira execução sem `public/`: o servidor sobe, mas as telas vêm do bundle do cliente.
fn build_client(dir: &Path) -> bool {
    Command::new("bun")
        .args(["run", "build:client"])
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Escapa o mínimo para embutir a mensagem num literal JS (aspas, barras e quebras).
fn js_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let quoted = js_escape(message);
        let _ = window.eval(&format!("window.nerdWatchError(\"{quoted}\")"));
    }
}

fn start_server_then_load(app: AppHandle) {
    let located = match app_dir(&app) {
        Some(located) => located,
        None => {
            show_error(&app, "não achei os arquivos do app: defina NERD_WATCH_DIR");
            return;
        }
    };
    let dir = located.dir;

    let log = open_log(&dir);
    if !dir.join("public").join("index.html").exists() && !build_client(&dir) {
        show_error(&app, "falha no build do cliente (bun run build:client)");
        return;
    }

    let port = pick_port(preferred_port());
    let mut command = Command::new("bun");
    command
        .arg("src/server/index.ts")
        .current_dir(&dir)
        .env("PORT", port.to_string())
        .stdin(Stdio::null());

    // Na versão instalada, os recursos em `_up_/` são substituídos pelo update: lista, progresso e
    // torrents ficam no diretório de dados do usuário para sobreviver à atualização.
    if located.bundled {
        if let Ok(data) = app.path().app_local_data_dir() {
            let _ = std::fs::create_dir_all(&data);
            command.env("DB_PATH", data.join("nerd-watch.db"));
            command.env("TORRENT_PATH", data.join("torrents"));
        }
    }

    match &log {
        // No app empacotado não existe console: a saída do servidor vai para .cache/desktop.log.
        Some(file) => {
            command.stdout(Stdio::from(file.try_clone().expect("clone do log")));
            command.stderr(Stdio::from(file.try_clone().expect("clone do log")));
        }
        None => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    let child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            show_error(&app, &format!("não consegui rodar o bun ({err}). Instale o Bun: https://bun.sh"));
            return;
        }
    };
    if let Some(state) = app.try_state::<ServerProcess>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    }

    if !wait_health(port, Duration::from_secs(45)) {
        show_error(&app, "o servidor local não respondeu em 45s (veja .cache/desktop.log)");
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{port}/");
        let _ = window.navigate(url.parse().expect("url de loopback válida"));
    }

    // Depois da UI na tela: baixar update em paralelo não pode atrasar a abertura.
    check_updates(app.clone());
}

fn stop_server(app: &AppHandle) {
    if let Some(state) = app.try_state::<ServerProcess>() {
        if let Some(mut child) = state.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn append_log(dir: &Path, line: &str) {
    let path = dir.join(".cache").join("desktop.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[updater] {line}");
    }
}

/// Auto-update: o app checa o `latest.json` da última release a cada boot e, se houver versão nova
/// assinada com a chave de `plugins.updater.pubkey`, instala e reinicia. Falha de rede não pode
/// atrapalhar o uso: o erro só vai para o log e o app segue na versão atual.
fn check_updates(app: AppHandle) {
    let dir = app_dir(&app).map(|located| located.dir).unwrap_or_else(|| PathBuf::from("."));
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(updater) => updater,
            Err(err) => {
                append_log(&dir, &format!("indisponível: {err}"));
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                append_log(&dir, &format!("versão {} disponível (atual {})", update.version, update.current_version));
                if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
                    append_log(&dir, &format!("falha ao instalar {}: {err}", update.version));
                    return;
                }
                append_log(&dir, "instalado — reiniciando");
                // O servidor Bun é filho deste processo: sem derrubar antes, o restart deixa órfão.
                stop_server(&app);
                app.restart();
            }
            Ok(None) => append_log(&dir, "nenhuma versão nova"),
            Err(err) => append_log(&dir, &format!("consulta falhou: {err}")),
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            // A janela nasce no splash e é navegada para o loopback quando o /api/health responde.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("nerd-watch")
                .inner_size(1280.0, 860.0)
                .min_inner_size(960.0, 620.0)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || start_server_then_load(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o nerd-watch")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                stop_server(app);
            }
        });
}
