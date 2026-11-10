# ADR 0005 — Desktop roda um sidecar compilado, não `node_modules`

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

A primeira versão do shell Tauri (`src-tauri/`) embarcava `src/`, `public/`, `package.json` e
`node_modules` como recursos e chamava `bun` do PATH. Funcionava, mas é o oposto do que o Tauri
oferece: instalador de 34 MB com milhares de arquivos, dependência de um runtime global e
`node_modules` tratado como "asset". O caminho previsto pelo Tauri para um backend local é
`bundle.externalBin`: um binário por alvo, ao lado do executável, iniciado pelo shell.

## Decisão

1. `scripts/build-server.ts` compila o servidor com `bun build --compile` para
   `src-tauri/binaries/nerd-watch-server-<triplo>.exe` (o nome que `externalBin` exige).
2. O instalador leva **só** esse executável e `public/` (cliente) como recurso. Nada de
   `node_modules`, nada de Bun instalado na máquina.
3. `src/server/torrent/webrtc-off.ts` entra no lugar de `node-datachannel` **apenas no build do
   sidecar** (plugin `onResolve` do `Bun.build`). Módulo nativo `.node` não entra em executável
   único, e o `webrtc-polyfill` (usado pelo webtorrent) o importa no topo do módulo — sem o stub o
   processo nem sobe. O stub falha só quando alguém tenta abrir um peer WebRTC; TCP/UDP, trackers
   HTTP e web seeds continuam iguais, que é o caminho do acervo público e da fonte Torrent.
4. `PUBLIC_DIR` passou a ser lido pelo servidor: instalado, o cliente mora em `_up_/public` (layout
   de recursos do Tauri), fora do cwd. Sem a variável, o padrão continua `./public`.
5. Banco, torrents e `.env` de runtime ficam em `%LOCALAPPDATA%` (dados) e na pasta de instalação
   (`.env`), fora do que o auto-update substitui.

## Consequências

- Instalador menor e sem árvore de dependências; abrir o app não depende de Bun.
- **Peers WebRTC não sobem no app desktop.** Quem precisa deles usa `bun run dev` ou Docker.
  TODO: se isso virar problema, o caminho é portar o backend para Rust ou distribuir um binário por
  plataforma compilado com `node --experimental-sea` (que também precisa extrair o `.node`).
- Qualquer dependência nativa nova quebra `build:server` — o build falha alto, não silencioso.
- `desktop:dev` recompila o sidecar antes de abrir; ciclo de dev continua com HMR do cliente.
