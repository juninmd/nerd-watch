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
| `stream` | `url` http(s) toca no player do app; `ytId` toca em embed; `externalUrl` abre fora; `infoHash` (torrent) fica listado como não suportado, porque o app só abre torrents do Internet Archive |
| `subtitles` | os addons instalados que declaram `subtitles` entram na busca de legendas junto com `SUBTITLE_ADDONS` |

## API local

`GET/POST /api/stremio/addons`, `DELETE /api/stremio/addons/:id`, `GET /api/stremio/addons/:id/{catalog/:type/:catalogId | meta/:type/:itemId | streams/:type/:itemId}`.

Não verificado contra addons reais nesta sessão: coberto por testes com `fetch` falso e por typecheck.

## Addon só de streams (sem catálogo)

Addons como o Brazuca declaram só `stream` e `catalogs: []`: não listam títulos, então "explorar" não aparece. A tela de addons diz isso e mostra o status (manifest respondendo ou erro). Na página de um filme/série do TMDB, o painel "Streams dos addons" resolve o IMDb (`tt…`) e consulta cada addon com `stream` (`GET /api/stremio/streams`). Streams só de torrent (`infoHash`) são listados como não suportados.
