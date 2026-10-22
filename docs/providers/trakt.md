# Trakt

Importa o que você já assistiu no Trakt para a sua lista do nerd-watch, e (por ação sua) envia o que você marcou
como assistido aqui para o histórico do Trakt.

Não é fonte de vídeo: só o cartão em Conexões e duas rotas (`/api/trakt/import` e `/api/trakt/export`).

## Variáveis de ambiente

| Variável | Segredo | Para que serve |
|---|---|---|
| `TRAKT_CLIENT_ID` | não | Client ID do app (também é o `trakt-api-key` das requisições) |
| `TRAKT_CLIENT_SECRET` | sim | Client secret do app. Nunca volta para o navegador. |
| `TRAKT_REFRESH_TOKEN` | sim | Gravado pelo app depois de conectar. Gira a cada renovação. |

`TMDB_API_KEY` é opcional aqui: sem ela, o import só atualiza títulos que já estão na sua lista.

## Cadastro do app (uma vez)

1. Entre em trakt.tv/oauth/applications (ou o painel de desenvolvedor em developer.trakt.tv) e crie um app novo.
2. Nome: `nerd-watch`. Em *Redirect URI* coloque exatamente `http://127.0.0.1:<PORT>/api/sources/trakt/oauth/callback`
   (a URL aparece no passo a passo dentro de Conexões).
3. Copie o Client ID e o Client secret para os campos de Conexões e clique em *Conectar Trakt*.

## Comportamento

### Importar (`POST /api/trakt/import`)

- Lê `GET /sync/watched/movies` e `GET /sync/watched/shows`, casa por **id TMDB** com os títulos `source='tmdb'`.
- Filme assistido vira `watched`.
- Série vira `watched` só se, para cada temporada regular que a TMDB conhece, todos os episódios de 1 a N foram vistos
  (especiais, temporada 0, não contam). Caso contrário vira `watching`, com `current_season`/`current_episode` no último
  episódio visto.
- Sem dado da TMDB a série nunca é marcada como completa (conservador).
- Título que não está na lista: se `TMDB_API_KEY` estiver configurada, é criado com os dados da TMDB; se não,
  conta como `skippedNoTmdb` e nada é inventado.
- Nunca rebaixa: `watched` não volta a `watching`; `dropped` (abandonado) nunca é alterado pelo import; o ponteiro de
  episódio só avança.
- Idempotente: rodar de novo devolve `imported: 0, updated: 0`.

Resposta: `{ imported, updated, unchanged, skippedNoTmdb, failed }`.

### Exportar (`POST /api/trakt/export`, corpo `{ "confirm": true }`)

- Sem `confirm: true` responde 400 e não chama o Trakt.
- Compara com o histórico do Trakt antes de enviar (o `POST /sync/history` não deduplica).
- Envia só filmes e séries `watched` com id TMDB que ainda não estão no Trakt, em lotes de 100, com ~1 s entre lotes.
- Série já presente no Trakt (com qualquer episódio) não é reenviada: a exportação não completa séries parciais.
- Resposta: `{ exported, alreadyInTrakt, skippedNoTmdb, notFound }`. Se um lote falhar (429, por exemplo), a resposta
  traz `partial` com as contagens até ali; rodar de novo é seguro.

## Erros

| Situação | Resposta |
|---|---|
| Não conectado | 501, pede para conectar em Conexões |
| Autorização expirada (`invalid_grant` ou 401 após renovar) | 409, pede para reconectar |
| Limite de requisições (429) | 429, informa o `Retry-After` quando o Trakt manda |
| Outro erro do Trakt | 502 com mensagem nossa; o corpo do Trakt nunca é repassado |

## Documentação consultada

Confirmado na documentação oficial (developer.trakt.tv, `docs/required-headers`):
- headers `Content-Type: application/json`, `trakt-api-version: 2`, `trakt-api-key` (= client ID), `User-Agent` recomendado.

Confirmado em `docs/rate-limiting`:
- `429 Too Many Requests`; `Retry-After` em segundos, quando presente, deve ser respeitado.
- Escrita (POST): 1 chamada por segundo por usuário. Leitura: 500 a cada 5 minutos (valores do exemplo; o
  header `X-Ratelimit` traz o real).

Confirmado em `docs/authentication-oauth`:
- PKCE é suportado (recomendado para login de usuário, sem client secret).
- Access token vale 7 dias.
- Refresh token é de uso único: cada renovação devolve um novo e invalida o anterior. O cliente OAuth grava o novo.

Não confirmado (verificar antes de publicar):
- Endpoints de autorização e de token. O código usa `https://auth.trakt.tv/oauth/authorize` e
  `https://auth.trakt.tv/oauth/token`, indicados por fontes da comunidade. A doc oficial não foi lida por inteiro.
- Se o token endpoint aceita o corpo em formulário (o cliente genérico envia `application/x-www-form-urlencoded`).
  Se o Trakt exigir JSON, é preciso um ajuste no cliente OAuth.
- Se o redirect para `http://127.0.0.1` é aceito pelo Trakt (loopback). Não encontrei a regra na doc.
- Formato exato de `GET /sync/watched/*` (campos `show.ids.tmdb`, `seasons[].episodes[].number`) e do corpo e da resposta
  de `POST /sync/history` (`added`, `not_found`). O formato usado nos testes segue os objetos padrão, mas não foi
  copiado de uma resposta oficial completa.
- Se o `scope` vazio é aceito no authorize, e se existe endpoint de revogação (por isso o disconnect só esquece o token
  localmente).

## Limites conhecidos

- Não há verificação contra uma conta Trakt real: os testes usam um Trakt falso.
- Export não completa séries parciais no Trakt, e não envia `watched_at` (o Trakt usa o momento do envio).
- O import busca a lista inteira de assistidos (sem paginação); para contas muito grandes isso vira uma resposta grande.
- Quando a TMDB é consultada, é uma chamada por série que ainda pode mudar (em paralelo, com teto de 4).
