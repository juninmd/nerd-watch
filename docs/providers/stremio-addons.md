# Addons do Stremio

Tela **Addons Stremio** (`#/addons`, atalho `g o`). Implementa o [protocolo de addons](https://stremio-addons.net/): `manifest.json` e os recursos `catalog`, `meta`, `stream` e `subtitles`.

## Ligar, desligar e remover

`PATCH /api/stremio/addons/:id` com `{ "enabled": false }` desliga o addon **sem removê-lo**: ele
continua na lista (para reativar) mas sai de toda consulta automática — página de título, busca,
quadros do Descobrir e busca de legendas. Abrir o addon pelo botão "explorar" continua funcionando:
é acesso explícito, não fan-out.

- Reinstalar o mesmo link preserva o estado (não religa sozinho) e não duplica.
- Banco criado antes da coluna `enabled` ganha `1` na migração (idempotente): quem atualiza não perde
  nenhum addon.

## Instalação manual, nada automático
- Não há addon pré-instalado, lista de descoberta nem instalação automática. O usuário cola o link do `manifest.json` (ou `stremio://…`).
- Cada addon é de terceiros: o conteúdo, o catálogo e a licença são de responsabilidade de quem o publica.

## Segurança

- A URL é validada: `http(s)`/`stremio://`, termina em `/manifest.json`, sem `usuário:senha@`, sem query, host público (nada de localhost, rede local ou nome sem ponto). O nome resolvido também precisa dar IP público, e cada redirect passa pela mesma checagem.
- Tempo limite de 10 s e teto de 2 MB por resposta; falhas viram mensagens fixas (400/502/504), sem repassar texto do addon.
- Fan-out com **teto de 4 addons em voo** por título (ordem preservada no resultado): rajada vira 429 no addon e segura sockets do app local.
- O "status" de cada addon tem cache curto no servidor (60 s para resposta boa, 10 s para erro) com dedupe em voo: abrir a tela de addons não refaz um manifest por addon a cada visita.
- O link guardado (`stremio_addons.manifest_url`) pode ter token no caminho: **nunca volta para o cliente** (a API devolve só o domínio), não aparece na lista de fontes de legenda indisponíveis e **não entra no backup**.
- Tudo que o addon devolve é normalizado: imagens e streams só `http(s)`; `ytId` vira embed `youtube-nocookie`; o resto é descartado. No HTML, tudo passa por `escapeHtml`.
- Limite de 20 addons instalados.

### Lista longa de streams

Addon de torrent responde até **500 streams** por título (teto do banco dele, sem `skip`). A tela mostra
os **8 primeiros** de cada addon e um botão "mostrar todos (N)"; acima de 500 a lista avisa que veio no
teto do addon. Isso evita montar centenas de cartões no DOM de uma vez e deixa a comparação entre addons
legível.

## O que cada recurso faz no app

### Manifest: o que o app guarda

Além de nome/versão/recursos/catálogos, o manifest guardado carrega:

- `background` (imagem de fundo do addon, usada no cabeçalho da tela de catálogo);
- `idPrefixes` — união do topo do manifest com os `idPrefixes` de **cada recurso**, que é o formato
  usado pelos addons de torrent (`resources: [{ name: "stream", idPrefixes: ["tt","kitsu"] }]`).
  Addon que não declara `tt` não é consultado nos títulos do app: a requisição seria vazia por desenho;
- `behaviorHints.configurable` / `configurationRequired`, exibidos na lista de addons. **Não** há botão
  de configurar: a configuração desses addons vai no caminho da URL (pode conter token de debrid), e o
  app não expõe o link do manifest ao navegador.

Manifest gravado por versão anterior (sem essas chaves) é normalizado na leitura, então atualizar o app
não quebra os addons já instalados.
| Recurso | Uso |
|---|---|
| `catalog` | explorar o catálogo, com busca (`search`), gênero (`genre`), ano (`year`) e paginação (`skip`) — cada filtro só é oferecido quando o manifest o declara |
| `meta` | pôster, fundo, sinopse, gêneros, trailer e episódios |
| `stream` | `url` http(s) toca no player do app; `ytId` toca em embed; `externalUrl` abre fora; `infoHash` (torrent) toca no motor P2P local, igual a um magnet colado em Conexões |
| `subtitles` | os addons instalados que declaram `subtitles` entram na busca de legendas junto com `SUBTITLE_ADDONS` |

### Catálogos: Descobrir, gênero e ano

- `#/descobrir` (atalho `g u`) monta um trilho por catálogo publicado pelos addons instalados
  (`GET /api/stremio/boards`, sem rede no servidor: sai do manifest guardado). Filmes e séries vêm
  primeiro, o total é limitado (8 trilhos, 14 itens cada) e um addon lento só deixa o próprio trilho
  com aviso.
- A tela de catálogo do addon mostra chips com os **gêneros que o próprio manifest declara**
  (`extra[name=genre].options`). Gênero fora dessa lista é 400 em vez de virar catálogo vazio.
- O filtro `year` segue a mesma regra: só passa se o manifest declarar `year`; o valor precisa ser
  `AAAA`.

### Busca

Os catálogos que declaram `search` recebem o termo no próprio protocolo. Um addon que só tem catálogos
sem busca (como o FenixFlix) não ficaria de fora: a primeira página de até 4 catálogos por addon (8 no
total por busca) é lida e filtrada pelo nome aqui, sem caixa e sem acento. É uma aproximação do que já
veio na página — o item aparece na busca com o pôster do addon e abre na ficha dele.

### Stream por torrent (`infoHash`)

Addons de torrent publicam `infoHash` (+ `fileIdx`, `sources` e `behaviorHints.filename`) em vez de uma
URL de arquivo. O app toca isso no mesmo motor P2P do Internet Archive:

- o infohash é validado (40 hex) e vira um magnet canônico (`xt` + `dn` + um `tr` por tracker). `dht:`
  e esquemas que não são tracker saem; tracker em loopback/LAN também;
- **o cliente nunca manda infohash**: ele manda só a posição do stream na lista, e o servidor reconsulta
  o addon para pegar o que ele respondeu agora;
- `fileIdx` escolhe o arquivo; se o podcast/mkv não tocar no navegador, a lista mostra o erro e o
  usuário escolhe outro stream;
- **pack de temporada sem `fileIdx`**: o id do episódio (`tt…:T:E`) vira uma busca pelo nome do arquivo
  (`S01E02`, `1x02`, `Season 1 Episode 2`), então o pack abre no episódio certo em vez do primeiro
  vídeo tocável. Só `mp4`/`m4v`/`webm` entram na busca — mkv daria 404 no stream;
- trocar de arquivo no painel manda `fileIndex` explícito e vence a busca por episódio;
- vale `TORRENT_ENABLED=false` (o botão some), `TORRENT_MAX_ACTIVE` (LRU) e o sweeper de ociosidade:
  sair da tela fecha o torrent, nada fica semeando;
- o texto do título/trackers vem de terceiros: passa por `cleanName`, `safeTrackers` e `escapeHtml`.

### Texto e vídeos de aviso

- Título, sinopse e nome de catálogo passam por `decodeEntities` antes de ir para o banco: o addon de
  torrent devolve `Can&#039;t` cru, e a interface escaparia a entidade de novo mostrando `&#039;` na tela.
  Entidade desconhecida e código fora do Unicode ficam como vieram; caractere de controle é removido.
- Addon de torrent responde `200` com um **vídeo de aviso** quando o token do debrid é inválido, o
  cache do provedor encheu ou o download está em andamento (`/videos/failed_access_v3.mp4`,
  `/videos/limits_exceeded_v2.mp4`, `name: "Torrentio\nTB error"`). Isso vira `kind: "error"`, com
  `url: null`: o cartão mostra o aviso e **não** oferece play — antes o usuário abria o cartaz de erro
  achando que era o filme. A detecção olha só o caminho do vídeo, não o título.

### Legendas que o addon publica (`stream.subtitles`)

Addon de torrent costuma oferecer a legenda dublada/legendada junto do stream. Agora o app usa:

- o manifest responde `subtitles: [{ url, lang, id }]` por stream; a **URL fica no servidor** (o cliente
  recebe só `{ id, lang }`) e a lista aparece no menu de legendas do player, antes das da busca;
- ao escolher, o cliente pede `GET /api/stremio/addons/:id/subtitles/:type/:itemId/:streamIndex/:subIndex`;
  o servidor reconsulta o addon, valida o host público e baixa o arquivo com os mesmos limites das outras
  legendas (2 MB, redirect checado por salto, conversão SRT/ASS→WebVTT);
- a preferência de idioma do usuário já seleciona a faixa do addon quando ela existe;
- faixa com endereço privado/estranho é descartada na normalização e não vira selo no card.

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

`GET/POST /api/stremio/addons`, `DELETE /api/stremio/addons/:id`, `GET /api/stremio/boards`,
`GET /api/stremio/addons/:id/{catalog/:type/:catalogId | meta/:type/:itemId | streams/:type/:itemId}`,
`GET /api/stremio/streams?mediaType=&tmdbId=|imdbId=&season=&episode=` (todas as fontes do título;
cada grupo traz `type`, `contentId` e a posição `index` de cada stream). Quando a tela é a de um item
de catálogo do addon, acrescente `addonId=`, `type=` e `itemId=`: os streams do próprio addon entram
pelo id original (mesmo sem IMDb) junto com os outros addons de stream resolvidos pelo IMDb,
`GET /api/stremio/addons/:id/subtitles/:type/:itemId/:streamIndex/:subIndex` (WebVTT da faixa que o
addon publicou para aquele stream) e
`POST /api/stremio/addons/:id/streams/:type/:itemId/:index/open?fileIndex=N` (abre o torrent no motor
P2P e devolve o mesmo contrato de `POST /api/torrent/open`).

Coberto por testes com `fetch` falso, WebTorrent falso e sem rede; a verificação contra addons reais é o
workflow `Addon probe`, que depende do segredo.

## Addon só de streams (sem catálogo)

Addons como o Brazuca declaram só `stream` e `catalogs: []`: não listam títulos, então "explorar" não aparece. A tela de addons diz isso e mostra o status (manifest respondendo ou erro). Na página de um filme/série do TMDB, o painel "Streams dos addons" resolve o IMDb (`tt…`) e consulta cada addon com `stream` (`GET /api/stremio/streams`).

O painel usa o player do app, não uma aba nova: `url` e `ytId` tocam embutidos, `externalUrl` abre fora e
`infoHash` vai para o motor P2P local (o vídeo aparece na coluna principal). Torrentio, Brazuca e FenixFlix
funcionam sem catálogo por esse caminho.

No episódio de série, "Assistir" num arquivo ou torrent abre o player dedicado (`#/play/{tvmaze|tmdb}/{id}/{temporada}/{episódio}`):
vídeo grande, fila da temporada e todas as fontes na lateral. A fonte escolhida (addon + resolução) fica salva no
navegador e é a primeira tentada no próximo episódio; com "próximo episódio automático" ligado, o fim do vídeo marca o
episódio como visto e abre o seguinte depois de 10 s. Atalhos: Shift+N e Shift+P.

## Item aberto no catálogo do addon

A tela do item (`#/addons/<id>/<type>/<itemId>`) usa o `meta` do addon para o banner, o pôster e o
trailer (`trailerStreams`/`trailers`, só ids do YouTube) e consulta **todos** os addons de stream, não
só o dono do catálogo: os streams do próprio addon entram pelo id original (o que funciona para ids sem
IMDb, como `afhd:…`) e os outros entram pelo IMDb quando o id é `tt…`. Assim, um item do FenixFlix
também lista os torrents do Torrentio na mesma lista.

## Referência: Torrentio

O Torrentio é o caso mais completo de addon de torrent e está dissecado em [torrentio.md](torrentio.md)
com o retrato legível por máquina em [`torrentio.capabilities.json`](torrentio.capabilities.json).
O que muda em relação aos outros addons:

- a configuração (provedores, filtros, debrid) vai no **caminho** do manifest
  (`/providers=yts|sort=seeders/manifest.json`); o app já guarda a URL inteira e usa o `baseUrl` com a config;
- a resposta tem teto de **500 streams** e `limit` conta por qualidade, não pelo total;
- com chave de debrid o manifest ganha catálogos `other` e o recurso `meta`, e os streams viram `url`
  de `/resolve/…` (sem `infoHash`) — essa URL carrega o token no caminho, então não pode ir crua ao cliente.
