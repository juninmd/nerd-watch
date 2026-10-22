# Plex

Seções de filmes e séries de um servidor Plex viram canais no nerd-watch. Uma série específica também pode virar canal, informando `show:<ID>`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PLEX_URL` | sim | Endereço do servidor, ex.: `http://192.168.0.10:32400`. Pode ser IP da LAN. Sem usuário e senha no endereço. |
| `PLEX_TOKEN` | sim (segredo) | Token do Plex (`X-Plex-Token`). Gravado no `.env` pela tela de Conexões; nunca volta ao navegador. |

## Cadastro

1. Pegue o token seguindo a página oficial do Plex: **"Finding an authentication token / X-Plex-Token"** (`https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/`).
2. Em Conexões, cole o endereço do servidor e o token.
3. Em **Adicionar**, informe:
   - o **nome** da seção (ex.: `Filmes`) ou o **número** dela (`key`);
   - ou `show:<ID>` para uma série, em que `<ID>` é o `ratingKey` do item (aparece na URL do item no Plex Web).

> O token dá acesso à sua conta Plex. Trate como senha.

## Como funciona

- **Autenticação:** cabeçalho `X-Plex-Token`, com `X-Plex-Client-Identifier` e `X-Plex-Product` (`nerd-watch`). JSON é pedido com `Accept: application/json`, porque sem ele o Plex responde XML. O token nunca vai na URL.
- **Seção de filmes:** `GET /library/sections/<key>/all?type=1&sort=addedAt:desc`.
- **Seção de séries:** `type=4` (episódios), não as séries em si.
- **Série:** `GET /library/metadata/<ratingKey>/allLeaves` (todos os episódios).
- **Paginação:** `X-Plex-Container-Start` e `X-Plex-Container-Size`, até 500 itens.
- **Título:** episódio vira `Série SxxEyy — Nome`; filme usa o título.
- **Duração:** `duration` em milissegundos, convertida para segundos. Data de inclusão: `addedAt` (segundos desde a época).
- **Reprodução:** `GET /library/metadata/<ratingKey>` para achar `Media[0].Part[0].key`, depois a parte com `Range` repassado. Só caminhos que casam `/library/parts/<id>/<versão>/<arquivo>` são aceitos; qualquer outro (host próprio, `//`, `..`, query) é recusado antes da requisição.
- **Miniatura:** o caminho `thumb` do item (`/library/metadata/<id>/thumb/<versão>`) é baixado no servidor, com teto de 2 MB.

## Limites conhecidos

- **Sem transcodificação.** O navegador toca o arquivo original. Container ou codec que o navegador não reproduz não toca.
- **Seções de música e foto são recusadas.** Só filmes e séries.
- **Teto de 500 itens** por canal.
- **Miniatura é o arquivo original** do Plex, sem redimensionar: uma capa grande demais (acima de 2 MB) fica sem capa.
- **`show:<ID>` precisa do ID** que aparece na URL do item no Plex Web.
- **Client identifier fixo** (`nerd-watch`): suficiente para uma instalação só.

## Verificação feita

- Endpoints e parâmetros conferidos no código do `python-plexapi` (branch `master`, versão de hoje): `/library/sections`, `/library/sections/<key>/all` com `sort=addedAt:desc`, `/library/metadata/<key>/allLeaves`, `X-Plex-Container-Start`/`-Size`, `Media[].Part[].key`, tipos `movie=1`, `show=2`, `episode=4`.
- Cabeçalhos conferidos na documentação da API do Plex Media Server (`https://developer.plex.tv/pms/`): token no `X-Plex-Token`, `X-Plex-Client-Identifier` obrigatório junto do token, `Accept: application/json` para JSON, e os demais `X-Plex-*` opcionais.
- **Página oficial de token não foi lida:** a tentativa de abrir `support.plex.tv/articles/204059436…` retornou HTTP 403. O passo a passo acima segue o resumo de busca dessa página, não o texto dela.
- Testes com `fetch` falso (`tests/plex-source.test.ts`): não há chamada de rede nos testes.
- **Não houve verificação contra um servidor Plex real.**
