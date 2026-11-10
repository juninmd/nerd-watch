# AGENTS.md

## Workspace Instructions

- Stack: Bun, TypeScript, Hono, SQLite (`bun:sqlite`), client vanilla (sem framework).
- Lint & Validation: `bun run check` (`biome` + `tsc --noEmit` + `bun test`).
- Catálogo: TMDB (requer `TMDB_API_KEY`) + Internet Archive (`feature_films`, sem chave, domínio público).
- Local-first: tudo fica em `data/nerd-watch.db` (SQLite); nada é enviado a servidores próprios.
- Mapa do código e receitas ("onde ponho X"): [ARCHITECTURE.md](ARCHITECTURE.md). Leia antes de criar arquivo.

## Onde cada coisa mora

- `src/client/<feature>/`: tela (`*-page.ts`), peças e lógica pura da feature. Rotas em `src/client/app/routes.ts`.
- `src/client/api/<domínio>.ts`: chamadas HTTP tipadas. `src/client/ui/`: peças genéricas.
- `src/server/routes/` (HTTP) → `src/server/repo/` (SQL) → `src/server/<domínio>/` (regra pura).
- `tests/client`, `tests/server`, `tests/shared` espelham `src/`.

## Convenções

- Lógica sem DOM em módulo próprio, com teste; o arquivo que toca o DOM só liga as pontas.
- Dado externo (catálogo, arquivo, usuário) sempre passa por `escapeHtml` antes de virar HTML.
- Arquivos curtos e de um assunto só (a maioria tem menos de 300 linhas). Passou disso, divida por responsabilidade.
- Comentário explica o porquê, em pt-BR. Nomes de arquivo em kebab-case; telas terminam em `-page.ts`.
- SQL só em `src/server/repo/`. Migração sempre idempotente (`IF NOT EXISTS` ou checagem de coluna).

## Comandos

- `bun run dev`: build do cliente + servidor com watch. Mudou o cliente? `bun run build:client` de novo.
- `bun run check`: lint + tipos + testes (obrigatório antes de commit).
- `bun run smoke`: servidor de pé e rotas principais, incluindo cache e brotli dos estáticos.
- `bun run bench`: latência das rotas e peso da casca num banco temporário (`--titles N`, `--json arquivo`).
- `bun run seed`: catálogo fictício para ver a interface com dados.

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