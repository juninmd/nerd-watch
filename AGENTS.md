# AGENTS.md

Nerd Watch: catálogo local-first de filmes, séries e mídia de domínio público. Tudo fica em `data/nerd-watch.db` (SQLite); nada vai para servidores próprios. Mapa do código e receitas de "onde ponho X": [ARCHITECTURE.md](ARCHITECTURE.md). Leia antes de criar arquivo.

## Stack

- Bun, TypeScript, Hono, SQLite (`bun:sqlite`). Cliente em vanilla TS, sem framework. Desktop via Tauri (`src-tauri/`).
- Catálogo: TMDB (requer `TMDB_API_KEY`), Internet Archive (coleções de domínio público e licença livre marcada), Wikimedia Commons (sem chave). Addons do Stremio só por link colado (`docs/providers/stremio-addons.md`).

## Comandos

```bash
bun run dev            # build do cliente + servidor com watch
bun run build:client   # rode de novo se mudou o cliente
bun run check          # lint + tipos + testes (obrigatório antes de commit)
bun run smoke          # servidor de pé e rotas principais, com cache e brotli
bun run bench          # latência das rotas (--titles N, --json arquivo)
bun run seed           # catálogo fictício para ver a interface com dados
```

## Estrutura

- `src/client/<feature>/`: tela (`*-page.ts`), peças e lógica pura da feature. Rotas em `src/client/app/routes.ts`.
- `src/client/api/<domínio>.ts`: chamadas HTTP tipadas. `src/client/ui/`: peças genéricas.
- `src/server/routes/` (HTTP) → `src/server/repo/` (SQL) → `src/server/<domínio>/` (regra pura).
- `tests/client`, `tests/server`, `tests/shared` espelham `src/`.
- `docs/adr/`: decisões de arquitetura. `docs/providers/`: uma página por fonte.

## Convenções

- Lógica sem DOM vai em módulo próprio, com teste. O arquivo que toca o DOM só liga as pontas.
- Dado externo (catálogo, arquivo, usuário) passa por `escapeHtml` antes de virar HTML.
- Arquivos curtos e de um assunto só (a maioria tem menos de 300 linhas). Passou disso, divida por responsabilidade.
- Comentários explicam o porquê, em pt-BR. Nomes de arquivo em kebab-case; telas terminam em `-page.ts`.
- SQL só em `src/server/repo/`. Migração sempre idempotente (`IF NOT EXISTS` ou checagem de coluna).

## Gotchas

- `data/` é gitignored: o banco local nunca entra no repo.
- Dúvida sobre onde algo mora? Consulte `ARCHITECTURE.md` antes de criar arquivo.

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
