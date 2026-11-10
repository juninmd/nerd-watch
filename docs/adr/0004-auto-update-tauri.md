# ADR 0004 — Auto-update do desktop via Tauri + release por commit convencional

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

O app é um servidor Bun/Hono local com um shell Tauri (`src-tauri/`) que só abre a janela no
loopback. Sem release automatizado, atualizar significa `git pull` + `bun install` + rebuild na mão —
e a versão instalada não tem como saber que existe versão nova.

## Decisão

1. **Versão vem do histórico, não de um humano digitando.** `src/shared/release-version.ts` lê os
   commits desde a última tag `v*` e aplica conventional commits: `feat` → minor,
   `fix`/`perf`/`refactor` → patch, `!` ou `BREAKING CHANGE` → major. Commit que não pede release
   (`docs:`, `chore:`, `Merge ...`) **não** publica nada — release vazio faria todo mundo baixar
   update à toa. `workflow_dispatch` aceita `bump` forçado para bootstrap e hotfix.
2. **O release é o workflow `.github/workflows/release.yml`.** Push em `main` → calcula a versão,
   roda a validação (`reusable-validate`), aplica a versão em `package.json`/`tauri.conf.json`/
   `Cargo.toml` e publica com `tauri-apps/tauri-action`, que cria a tag `vX.Y.Z`, sobe o instalador
   NSIS, a assinatura `.sig` e o `latest.json`.
3. **O app se atualiza sozinho.** `tauri-plugin-updater` aponta para
   `https://github.com/juninmd/nerd-watch/releases/latest/download/latest.json`. No boot, o shell
   Rust checa, baixa, valida a assinatura (chave pública em `plugins.updater.pubkey`), instala e
   reinicia — derrubando o servidor Bun antes, para não deixar processo órfão. Erro de rede vai
   para `.cache/desktop.log` e o app segue funcionando na versão atual.
4. **A assinatura é obrigatória.** A chave privada vive só em `TAURI_SIGNING_PRIVATE_KEY` (secret do
   repositório) e no `~/.tauri/` de quem publica. Update sem assinatura válida é recusado pelo app:
   é isso que impede um `latest.json` adulterado de virar execução de código.

## Consequências

- O instalador leva **um executável** do servidor (`bun build --compile`, ver
  [ADR 0005](0005-desktop-sidecar.md)) e o cliente em `public/`. Nada de `node_modules` e nada de
  Bun instalado na máquina.
- Publicar release passa a ser consequência de mergear commit convencional em `main`; PR com
  título fora do padrão não gera versão.
- Nada disso muda o app web (`bun run dev`) nem o Docker: os dois caminhos seguem iguais.
- Atualização automática não tem UI: o app reinicia sozinho quando há versão nova. Quem quiser
  controle manual desliga com `plugins.updater` vazio ou instala o `-setup.exe` por cima.
