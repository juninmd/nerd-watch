# ADR 0006 — Desktop embute o cliente e fala por IPC (padrão canto-widget)

- **Status:** aceito
- **Data:** 2026-11-10
- **Substitui parcialmente:** [ADR 0005](0005-desktop-sidecar.md) (que ainda vale para o sidecar)

## Contexto

O shell do ADR 0005 subia o servidor Hono numa porta de loopback e **navegava a janela para
`http://127.0.0.1:7799`**. Ou seja: o Tauri existia só para moldura, e o app continuava sendo uma
página servida por HTTP — o oposto do que o Tauri faz (frontend embutido, `frontendDist`) e do
padrão usado no `canto-widget` (janela em `tauri://localhost`, backend por IPC).

## Decisão

1. **Frontend embutido**: `build.frontendDist = ../public`. A janela abre em
   `tauri://localhost/index.html`; não há navegação para localhost e o `public/` não vai mais como
   recurso solto.
2. **API por IPC**: `src/server/app.ts` exporta o Hono sem processo; `src/server/worker.ts` é o
   entrypoint do sidecar e responde JSON por linha no stdin/stdout. O shell Rust expõe o comando
   `api_request` e o cliente troca `fetch('/api/*')` por `invoke('api_request')` em
   `src/client/platform/tauri.ts` (instalado só quando `isTauri()`).
3. **Loopback só para bytes**: vídeo, imagem, legenda e torrent precisam de `<video>`/`<img>` e
   `Range`; o protocolo de IPC do Tauri bufferiza a resposta e não serve para streaming. O worker
   sobe um `Bun.serve` em porta aleatória **sem** o cliente navegar para ele, e o shell injeta a
   base em `window.__NERD_WATCH_MEDIA_BASE__`; URLs `/api/...` de mídia são reescritas para ela.
4. **Link externo abre no navegador**: `on_navigation` no Rust + interceptor de clique (e
   `window.open`) mandam http(s) para o navegador do sistema via comando `open_external`. Nada de
   trailer, streaming ou OAuth dentro da janela.
5. **Service worker desligado no desktop**: a casca já está no binário; `sw.js` só existe em http(s).

## Consequências

- Abrir o app não depende de porta livre nem de espera por `/api/health`; o worker é iniciado antes
  da janela e o `ready` traz a base de mídia.
- O modo web (`bun run dev`), o Docker e os testes continuam idênticos: sem `isTauri()`, a ponte não
  instala nada e o `fetch` é o de sempre.
- Chamadas de API viram base64 no IPC; payloads grandes (biblioteca de 2000 títulos, ~900 kB) passam
  sem problema, mas não é caminho para vídeo — por isso o item 3.
- OAuth de Drive/Dropbox/OneDrive abre no navegador; o callback cai no loopback do worker (mesma
  porta aleatória, que precisa estar registrada no provedor — igual antes).
- Erros do worker aparecem como `Error` no cliente com a mensagem do servidor, mantendo o contrato
  de `src/client/api/http.ts`.
