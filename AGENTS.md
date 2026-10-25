# AGENTS.md

## Workspace Instructions

- Stack: Bun, TypeScript, Hono, SQLite (`bun:sqlite`), client vanilla (sem framework).
- Lint & Validation: `bun run check` (`biome` + `tsc --noEmit` + `bun test`).
- Catálogo: TMDB (requer `TMDB_API_KEY`) + Internet Archive (`feature_films`, sem chave, domínio público).
- Local-first: tudo fica em `data/nerd-watch.db` (SQLite); nada é enviado a servidores próprios.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.