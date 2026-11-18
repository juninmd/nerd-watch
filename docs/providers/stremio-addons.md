# Addons do Stremio

Tela **Addons Stremio** (`#/addons`, atalho `g o`). Implementa o [protocolo de addons](https://stremio-addons.net/): `manifest.json` e os recursos `catalog`, `meta`, `stream` e `subtitles`.

## Instalação manual, nada automático

- Não há addon pré-instalado, lista de descoberta nem instalação automática. O usuário cola o link do `manifest.json` (ou `stremio://…`).
- Cada addon é de terceiros: o conteúdo, o catálogo e a licença são de responsabilidade de quem o publica.

## Segurança

- A URL é validada: `http(s)`/`stremio://`, termina em `/manifest.json`, sem `usuário:senha@`, sem query, host público (nada de localhost, rede local ou nome sem ponto). O nome resolvido também precisa dar IP público, e cada redirect passa pela mesma checagem.
- Tempo limite de 10 s e teto de 2 MB por resposta; falhas viram mensagens fixas (400/502/504), sem repassar texto do addon.
- O link guardado (`stremio_addons.manifest_url`) pode ter token no caminho: **nunca volta para o cliente** (a API devolve só o domínio), não aparece na lista de fontes de legenda indisponíveis e **não entra no backup**.
- Tudo que o addon devolve é normalizado: imagens e streams só `http(s)`; `ytId` vira embed `youtube-nocookie`; o resto é descartado. No HTML, tudo passa por `escapeHtml`.
- Limite de 20 addons instalados.

## O que cada recurso faz no app

| Recurso | Uso |
|---|---|
| `catalog` | explorar o catálogo, com busca (`search`) e paginação (`skip`) quando o addon declara |
| `meta` | sinopse, gêneros e episódios |
| `stream` | `url` http(s) toca no player do app; `ytId` toca em embed; `externalUrl` abre fora; `infoHash` (torrent) toca no motor P2P local, igual a um magnet colado em Conexões |
| `subtitles` | os addons instalados que declaram `subtitles` entram na busca de legendas junto com `SUBTITLE_ADDONS` |

### Stream por torrent (`infoHash`)

Addons de torrent publicam `infoHash` (+ `fileIdx`, `sources` e `behaviorHints.filename`) em vez de uma
URL de arquivo. O app toca isso no mesmo motor P2P do Internet Archive:

- o infohash é validado (40 hex) e vira um magnet canônico (`xt` + `dn` + um `tr` por tracker). `dht:`
  e esquemas que não são tracker saem; tracker em loopback/LAN também;
- **o cliente nunca manda infohash**: ele manda só a posição do stream na lista, e o servidor reconsulta
  o addon para pegar o que ele respondeu agora;
- `fileIdx` escolhe o arquivo; se o podcast/mkv não tocar no navegador, a lista mostra o erro e o
  usuário escolhe outro stream;
- vale `TORRENT_ENABLED=false` (o botão some), `TORRENT_MAX_ACTIVE` (LRU) e o sweeper de ociosidade:
  sair da tela fecha o torrent, nada fica semeando;
- o texto do título/trackers vem de terceiros: passa por `cleanName`, `safeTrackers` e `escapeHtml`.

## Addon configurado por ambiente (sem domínio no repositório)

`ADDON_MANIFEST_URLS` (uma ou mais URLs separadas por vírgula) instala addons no boot, para quem quer
um addon sempre presente sem colar o link na mão. Regras:

- o valor vem do `.env` ou de um segredo do repositório (`ADDON_MANIFEST_URLS`), porque o caminho do
  manifest pode carregar token;
- nada acontece sem a variável: a instalação manual pela tela continua sendo o caminho padrão;
- o link passa pela mesma validação da instalação manual (host público, sem query, `/manifest.json`) e
  é idempotente — reiniciar não duplica;
- falha de um addon é registrada só pelo host e não impede o boot.

No CI, `bun run scripts/addon-probe.ts` (workflow `Addon probe`) confere os addons configurados com o
segredo e imprime apenas nome/recursos/contagem de streams — nunca o endereço.

## API local

`GET/POST /api/stremio/addons`, `DELETE /api/stremio/addons/:id`,
`GET /api/stremio/addons/:id/{catalog/:type/:catalogId | meta/:type/:itemId | streams/:type/:itemId}` e
`POST /api/stremio/addons/:id/streams/:type/:itemId/:index/open?fileIndex=N` (abre o torrent no motor
P2P e devolve o mesmo contrato de `POST /api/torrent/open`).

Coberto por testes com `fetch` falso, WebTorrent falso e sem rede; a verificação contra addons reais é o
workflow `Addon probe`, que depende do segredo.

## Addon só de streams (sem catálogo)

Addons como o Brazuca declaram só `stream` e `catalogs: []`: não listam títulos, então "explorar" não aparece. A tela de addons diz isso e mostra o status (manifest respondendo ou erro). Na página de um filme/série do TMDB, o painel "Streams dos addons" resolve o IMDb (`tt…`) e consulta cada addon com `stream` (`GET /api/stremio/streams`). Streams de torrent (`infoHash`) tocam no motor P2P local.
