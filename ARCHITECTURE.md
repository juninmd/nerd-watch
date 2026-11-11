# Arquitetura

Mapa do repositório para quem vai mexer nele, pessoa ou LLM. Diz onde cada coisa mora, como os pedaços se
falam e onde encaixar uma mudança. Regras do dia a dia (comandos, padrões de CI) ficam em [AGENTS.md](AGENTS.md).

## Visão em uma tela

```
navegador (TypeScript sem framework)          servidor (Bun + Hono, só loopback)           disco
┌──────────────────────────────┐   /api/*    ┌──────────────────────────────────┐    ┌──────────────────┐
│ src/client                   │ ──────────▶ │ src/server/routes  (HTTP, validação)│──▶│ data/nerd-watch.db│
│  app/   casca, rotas, atalhos│             │        │                          │    │ (SQLite, WAL)    │
│  api/   cliente HTTP tipado  │ ◀────────── │ src/server/repo    (SQL)          │    └──────────────────┘
│  <feature>/  telas e peças   │    JSON     │ src/server/<domínio> (regra pura) │
│  ui/    peças genéricas      │             │ src/server/providers (TMDB, etc.) │──▶ APIs externas
└──────────────────────────────┘             └──────────────────────────────────┘
        ▲ public/ (gerado pelo build: index.html + /assets/* com hash, .br e .gz)
```

O cliente só fala com o servidor por `/api/*`. O servidor é o único que fala com banco e com terceiros.
`src/shared` tem o pouco que os dois lados usam (conversão de legendas).

## Pastas

### `src/client`: uma pasta por feature

| Pasta | O que tem |
|---|---|
| `main.ts` | Monta a casca (menu, barra superior, player fixo) e despacha a rota. Não conhece nenhuma tela. |
| `app/` | Roteador de hash, **tabela de rotas** (`routes.ts`), títulos de rota, memória de rolagem, atalhos, paleta `Ctrl K`, estado global pequeno (spoilers, toast). |
| `api/` | Cliente HTTP, um arquivo por domínio (`library.ts`, `telegram.ts`, `stats.ts`, ...). `index.ts` só reexporta. Os tipos `...Dto` espelham as respostas das rotas. |
| `ui/` | Peças sem regra de negócio: card, carrossel, ícones, efeitos (confete, tilt, transição de tela), formatação de data. |
| `home/`, `library/`, `lists/`, `catalog/`, `calendar/`, `stats/`, `channels/`, `connections/`, `player/` | A feature inteira: a tela (`*-page.ts`), suas peças e a lógica pura dela. |
| `pwa/` | Service worker, manifesto e ícone. |
| `styles/` | CSS por área, importado por `styles.css` e empacotado num arquivo só no build. `tokens.css` tem as variáveis. |

Convenções do cliente:

- **Tela** = `src/client/<feature>/<nome>-page.ts` exportando `render<Nome>(host, ...)`. Entra em `PAGES` e `ROUTES`
  de `app/routes.ts`. Cada tela vira um chunk baixado sob demanda.
- **Lógica pura separada do DOM.** Regra, texto e conta ficam em módulos sem `document` (ex.: `stats/model.ts`,
  `stats/insights.ts`, `player/player-seek.ts`) e são os que têm teste. O arquivo que toca o DOM só liga as pontas.
- **HTML por template string**, sempre com `escapeHtml` em qualquer dado que venha de catálogo, arquivo ou usuário.
- **Preferência de navegador** (layout, ritmo da fila, meta do ano) vai em `localStorage` com `try/catch`; dado da
  pessoa (lista, progresso) vai para o servidor.

### `src/server`: camadas por responsabilidade

| Pasta | O que tem |
|---|---|
| `index.ts` | Monta o app Hono, registra rotas e sobe os trabalhos de fundo. |
| `config/` | Variáveis de ambiente validadas (`config.ts`) e escrita segura do `.env`. |
| `http/` | O que é de HTTP e não de domínio: guarda de host/origem, acesso remoto por token, **arquivos estáticos** (`static.ts`), leitura de corpo JSON. |
| `routes/` | Uma rota Hono por recurso. Valida a entrada, chama repo/domínio, monta o DTO. Sem SQL. |
| `repo/` | Todo o SQL. Funções recebem `db` e devolvem linhas ou objetos de domínio. |
| `db/` | Conexão, schema, migrações idempotentes e o `seed` de demonstração. |
| `stats/`, `calendar/`, `lists/`, `saved-views/`, `media-name/`, `metadata/`, `notify/`, `subtitles/` | Regra pura do domínio, sem I/O: recebe dados, devolve resultado. |
| `providers/` | Um diretório por serviço externo (TMDB, Archive, Telegram, Drive, S3, ...). `providers/sources/` é o contrato comum das fontes de vídeo. |
| `media/`, `torrent/`, `telegram/` | Subsistemas com processo ou estado próprio (ffmpeg, WebTorrent, canais). |
| `lib/` | Utilitários sem dono: cache TTL, limite de taxa, datas, guardas de texto. |
| `types.ts` | Tipos de linha do banco e enums compartilhados com o cliente (só `import type`). |

Fluxo de uma leitura: `routes/x.ts` → `repo/x.ts` (SQL) → função pura do domínio → JSON.
Fluxo de uma escrita: a rota valida, o repo grava dentro de `db.transaction` junto com o histórico.

### `tests`: espelha `src`

`tests/client`, `tests/server` e `tests/shared`, um arquivo por unidade (`<assunto>.test.ts`). `fixtures/`,
`helpers/` e `support/` são compartilhados. Teste de rota usa `openDb(':memory:')` + `resetDbForTests`.
Não há DOM nos testes: por isso a lógica fica em módulos puros.

### `scripts`

`build-client.ts` (build), `smoke.ts` (servidor de pé + rotas principais), `bench.ts` (benchmark), `poc-*.ts`.

## Receitas

**Nova tela.** Crie `src/client/<feature>/<nome>-page.ts`; acrescente em `PAGES` e `ROUTES` (`app/routes.ts`);
rótulo em `app/route-meta.ts`; se for item de menu, `NAV_ITEMS` em `main.ts`; caso em `tests/client/routes.test.ts`.

**Novo endpoint.** `src/server/routes/<recurso>.ts` (validação + DTO) → SQL em `src/server/repo/<recurso>.ts` →
registre em `src/server/app.ts` → função tipada em `src/client/api/<domínio>.ts` → teste de rota em
`tests/server/<recurso>-route.test.ts`.

**Nova coluna ou tabela.** `CREATE ... IF NOT EXISTS` em `MIGRATIONS` (`db/database.ts`) ou uma função
`migrate...` idempotente chamada em `openDb`. Inclua no backup (`repo/backup.ts`) se for dado da pessoa.

**Nova fonte de vídeo.** Diretório em `src/server/providers/<fonte>/` implementando o contrato de
`providers/sources/types.ts`, registrado em `providers/sources/index.ts`. A tela de Conexões desenha o cartão
a partir do descritor; não precisa de código de cliente.

**Novo gráfico.** Função pura em `src/client/stats/charts.ts` (dados → markup), dados preparados em
`stats/model.ts` ou `stats/insights.ts`, montagem em `stats/render.ts`. Toda marca tem `data-tip` + `aria-label`
e o gráfico tem `dataTable` equivalente. Cores novas passam pelo validador de paleta antes de entrar.

## Desempenho: o que sustenta os números

- **Casca.** `scripts/build-client.ts` gera um chunk por tela, um CSS, nomes com hash e `.br`/`.gz`.
  `http/static.ts` entrega `/assets/*` com `immutable` e o resto com `ETag`. Revisita = uma requisição 304.
- **Telas.** `app/routes.ts` baixa a tela pedida e, no tempo ocioso, as outras.
- **Imagens.** Pôster é `<img loading="lazy">` com `srcset` (TMDB): só baixa perto da área visível e na resolução da tela.
- **SQL.** Consultas com teto no próprio SQL (agenda), uma consulta por agregação (estatísticas) e índices que
  cobrem o que é lido. Um `EXPLAIN QUERY PLAN` testado protege o plano de "próximos episódios".
- **Medição.** `bun run bench` sobe o servidor num banco temporário e mede por HTTP; roda igual em qualquer
  commit, então serve para comparar antes e depois.

## Limites que valem a pena conhecer

- Sem framework e sem DOM nos testes: interação de tela é conferida à mão ou por script de navegador.
- Um processo, um SQLite: não há fila nem worker. Trabalho de fundo é `setInterval` no próprio processo.
- O servidor confia em estar em loopback; o acesso remoto (`ACCESS_TOKEN`) é opcional e fica atrás de proxy HTTPS.
