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

/// Como o servidor é iniciado. O modo instalado usa o sidecar compilado (sem Bun, sem
/// `node_modules`); dev e `NERD_WATCH_DIR` continuam rodando o TypeScript direto com `bun`.
enum Server {
    /// Executável ao lado do app (recurso `externalBin` do Tauri).
    Sidecar(PathBuf),
    /// Repositório + `bun src/server/index.ts`.
    Script(PathBuf),
}

fn resolve_server() -> Option<Server> {
    if let Some(dir) = std::env::var_os("NERD_WATCH_DIR") {
        return Some(Server::Script(PathBuf::from(dir)));
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let sidecar = exe_dir.join("nerd-watch-server.exe");
    if sidecar.exists() {
        return Some(Server::Sidecar(exe_dir));
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    Some(Server::Script(dev)).filter(|server| match server {
        Server::Script(dir) => dir.join("package.json").exists(),
        Server::Sidecar(_) => true,
    })
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
    let server = match resolve_server() {
        Some(server) => server,
        None => {
            show_error(&app, "não achei o servidor: defina NERD_WATCH_DIR apontando para o repositório");
            return;
        }
    };
    let dir = match &server {
        Server::Sidecar(dir) => dir.clone(),
        Server::Script(dir) => dir.clone(),
    };

    let log = open_log(&dir);
    let port = pick_port(preferred_port());
    let mut command = match &server {
        // Sidecar: executável único, sem Bun e sem node_modules na máquina.
        Server::Sidecar(_) => Command::new(dir.join("nerd-watch-server.exe")),
        Server::Script(repo) => {
            if !repo.join("public").join("index.html").exists() && !build_client(repo) {
                show_error(&app, "falha no build do cliente (bun run build:client)");
                return;
            }
            let mut bun = Command::new("bun");
            bun.arg("src/server/index.ts");
            bun
        }
    };
    command
        .current_dir(&dir)
        .env("PORT", port.to_string())
        .stdin(Stdio::null());

    // O instalador é substituído pelo auto-update: lista, progresso e torrents ficam no diretório
    // de dados do usuário. O cliente é recurso da instalação (`_up_/public`, layout do Tauri).
    if matches!(server, Server::Sidecar(_)) {
        if let Ok(data) = app.path().app_local_data_dir() {
            let _ = std::fs::create_dir_all(&data);
            command.env("DB_PATH", data.join("nerd-watch.db"));
            command.env("TORRENT_PATH", data.join("torrents"));
        }
        if let Ok(resources) = app.path().resource_dir() {
            for base in [resources.clone(), resources.join("_up_")] {
                if base.join("public").join("index.html").exists() {
                    command.env("PUBLIC_DIR", base.join("public"));
                    break;
                }
            }
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
            let hint = match &server {
                Server::Sidecar(_) => "o sidecar do servidor não abriu — reinstale o app",
                Server::Script(_) => "instale o Bun: https://bun.sh",
            };
            show_error(&app, &format!("não consegui iniciar o servidor ({err}); {hint}"));
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
    let dir = match resolve_server() {
        Some(Server::Sidecar(dir)) | Some(Server::Script(dir)) => dir,
        None => PathBuf::from("."),
    };
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
