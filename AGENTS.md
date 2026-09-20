# AGENTS.md

## Workspace Instructions

- Stack: Bun, TypeScript, Hono, SQLite (`bun:sqlite`), client vanilla (sem framework).
- Lint & Validation: `bun run check` (`biome` + `tsc --noEmit` + `bun test`).
- Catálogo: TMDB (requer `TMDB_API_KEY`) + Internet Archive (`feature_films`, sem chave, domínio público).
- Local-first: tudo fica em `data/nerd-watch.db` (SQLite); nada é enviado a servidores próprios.
