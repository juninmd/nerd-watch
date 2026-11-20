# Torrentio — extração completa do addon

Referência do addon de torrent mais usado no Stremio, levantada em **20/11/2026** contra o addon em
produção (v0.0.15) e contra o código-fonte em `github.com/TheBeastLT/torrentio-scraper` (branch `master`).
Serve para integrar addons de torrent no app e para desenhar a configuração de addons no futuro.

O retrato legível por máquina (provedores, qualidades, idiomas, debrids, limites, campos) está em
[`torrentio.capabilities.json`](torrentio.capabilities.json). O que o app já faz com addons em geral está em
[`stremio-addons.md`](stremio-addons.md).

## Em uma tela

| Item | Valor |
|---|---|
| id / versão | `com.stremio.torrentio.addon` / `0.0.15` |
| recursos | só `stream`; com debrid configurado, `stream` + `meta` |
| tipos | `movie`, `series`, `anime`, `other` |
| ids | `tt…` (filme), `tt…:T:E` (série), `kitsu:…` (filme anime), `kitsu:…:E` (episódio anime) |
| catálogo próprio | nenhum sem debrid; com debrid, catálogos `other` dos downloads |
| configuração | no **caminho** da URL, antes de `/manifest.json`, pares `chave=valor` separados por `|` |
| `behaviorHints` | `configurable: true`, `configurationRequired: false` (funciona sem configurar) |
| teto de streams | 500 por resposta (limite do SQL, não da configuração) |

## Superfície HTTP

| Caminho | O que faz |
|---|---|
| `GET /` | 303 para `/configure` |
| `GET /configure` | página HTML de configuração (Alpine.js); monta o link `stremio://…/manifest.json` |
| `GET /lite`, `GET /brazuca` | 303 para os presets `/lite/configure` e `/brazuca/configure` |
| `GET /manifest.json` | manifest sem configuração |
| `GET /{config}/manifest.json` | manifest configurado (a descrição muda; com debrid, nome e catálogos mudam) |
| `GET /{config}/stream/{tipo}/{id}.json` | streams (o `.json` é obrigatório) |
| `GET /{config}/catalog/other/{catalogo}.json[/{extra}]` | catálogo de downloads do debrid (`skip` na paginação) |
| `GET /{config}/meta/other/{moch}:{item}.json` | detalhe de um download do debrid, com os arquivos em `videos[].streams[]` |
| `GET /resolve/{moch}/{api_key}/{info_hash}/{entrada}/{índice}[/{arquivo}]` | 302 para o link do debrid ou para um vídeo de erro |
| `GET /metrics` | Prometheus, HTTP Basic (401 sem credenciais) |
| `GET /videos/*`, `GET /images/*` | estáticos (vídeos de erro e imagens do manifest) |

CORS liberado (`access-control-allow-origin: *`), compressão `br`/`gzip`, `HEAD` aceito nas rotas de
recurso. Caminho desconhecido → 404; caminho de config desconhecido **não** é erro: `/qualquer-coisa/manifest.json`
devolve o manifest padrão.

## Configuração no caminho

```
https://torrentio.strem.fun/providers=yts,eztv|sort=seeders|limit=2|qualityfilter=480p,cam|language=portuguese/manifest.json
```

O parser (fonte: `domain/config.rs`) divide por `|`, depois por `=`, e **ignora** pares malformados
(`a=b=c` não entra), valores desconhecidos de `sort` (caem no padrão) e `limit` com zero à esquerda.
As chaves viram minúsculas; provedores, idiomas e qualidades também, enquanto `sizefilter` é normalizado
para maiúsculas.

| Chave | Valores | Padrão | Efeito real |
|---|---|---|---|
| `providers` | chaves da tabela abaixo, separadas por vírgula | todos | lista vazia = todos; lista preenchida **só** liga os citados; `!yts` não é exclusão (resulta em zero streams) |
| `sort` | `quality`, `qualitysize`, `seeders`, `size` | `quality` | ver ordenação |
| `language` | `japanese`, `portuguese`, … | sem preferência | **não filtra**: põe os streams com a bandeira na frente e mantém o resto |
| `qualityfilter` | `brremux`, `hdrall`, `dolbyvision`, `dolbyvisionwithhdr`, `threed`, `nonthreed`, `4k`, `1080p`, `720p`, `480p`, `other`, `scr`, `cam`, `unknown` | nenhum | **exclui** as qualidades listadas (comparação exata; `1080p` não tira `1080p HDR`) |
| `limit` | inteiro | sem limite de config | teto **por balde de qualidade**, não pelo total |
| `minseeders` | inteiro | `0` | esconde streams abaixo do mínimo; ignorado quando há debrid |
| `sizefilter` | `1GB`, `500MB,10GB` | sem limite | um valor vale para filme e série; dois valores usam o **primeiro** para filme e o **último** para série; valor ilegível vira 0 bytes e zera a lista |
| `debridoptions` | `nodownloadlinks`, `nocatalog` | nenhuma | esconde links `[XX download]` / esconde catálogo e `meta` |
| `<debrid>` | token; `putio` usa `clientId@token` | vazio | liga disponibilidade, links `/resolve/…`, catálogo e `meta` |

### Presets

- `lite`: todos os provedores **sem bandeira estrangeira**, `qualityfilter=scr,cam` e `limit=1`.
- `brazuca`: provedores sem bandeira + os de bandeira 🇵🇹, `language=portuguese`.

São atalhos de config, não addons diferentes: o manifest continua `Torrentio`.

## Provedores (28)

| Grupo | Chaves |
|---|---|
| Geral (11) | `yts`, `eztv`, `rarbg`, `1337x`, `ext`, `thepiratebay`, `kickasstorrents`, `torrentgalaxy`, `uindex`, `knaben`, `magnetdl` |
| Anime (6) | `horriblesubs`, `nyaasi`, `animetosho`, `tokyotosho`, `anidex`, `nekobt` |
| Russo 🇷🇺 | `rutor`, `rutracker` |
| Português 🇵🇹 | `comando`, `bludv`, `micoleaodublado` |
| Outros idiomas | `torrent9` 🇫🇷, `ilcorsaronero` 🇮🇹, `mejortorrent` 🇪🇸, `wolfmax4k` 🇪🇸, `cinecalidad` 🇲🇽, `besttorrents` 🇵🇱 |

O manifest revela quais provedores estão ligados na descrição: `YTS(+)`, `RARBG(-)`. Isso é a única
pista da configuração que sai no manifest.

## Filtros e ordenação

**Qualidade.** O rótulo é a segunda linha de `stream.name` (`Torrentio\n1080p HDR`). A classificação
(`domain/filter.rs`) é:

| Chave | Regra |
|---|---|
| `brremux` | `bingeGroup` contém `BluRay REMUX` |
| `hdrall` | perfil contém `HDR`, `HDR10+` ou `DV` |
| `dolbyvision` | perfil é exatamente `DV` |
| `dolbyvisionwithhdr` | perfil tem `DV` **e** `HDR` |
| `threed` / `nonthreed` | perfil tem / não tem `3D` |
| `4k` | primeiro token é `4k` |
| `1080p`, `720p`, `480p` | igualdade exata da qualidade |
| `other` | primeiro token fora de `4k/1080p/720p/480p/SCR/CAM/TeleSync/TeleCine` |
| `scr` | exatamente `SCR` |
| `cam` | `CAM`, `TeleSync` ou `TeleCine` |
| `unknown` | qualidade ausente/vazia |

Consequência prática: `qualityfilter=1080p` **não** remove `1080p HDR` nem `1080p DV | HDR` — para isso
é preciso `hdrall` (ou `dolbyvision`). Medido: 500 → 246 streams com `qualityfilter=1080p,720p`.

**Ordenação** (`domain/sort.rs`):

| `sort` | Como ordena |
|---|---|
| `quality` (padrão) | agrupa por qualidade, resolução decrescente (HDR sobe `1080p→1081p`, `4k→2060p`, `8k→4320p`); dentro do grupo mantém a ordem do banco (seeders desc, data desc) |
| `qualitysize` | mesmos grupos, tamanho decrescente dentro de cada um |
| `seeders` | seeders decrescente (ordem do banco) |
| `size` | tamanho decrescente |

`limit` conta por balde de qualidade **depois** da ordenação e da prioridade de idioma. Exemplo medido
com `limit=2`: 21 streams em 13 baldes, no máximo 2 por balde.

## Manifest dinâmico

Sem configuração:

```json
{
  "id": "com.stremio.torrentio.addon",
  "version": "0.0.15",
  "name": "Torrentio",
  "catalogs": [],
  "resources": [{ "name": "stream", "types": ["movie", "series", "anime"], "idPrefixes": ["tt", "kitsu"] }],
  "types": ["movie", "series", "anime", "other"],
  "background": "https://torrentio.strem.fun/images/background_v1.jpg",
  "logo": "https://torrentio.strem.fun/images/logo_v1.png",
  "behaviorHints": { "configurable": true, "configurationRequired": false }
}
```

Com `torbox=…` (o mesmo vale para os outros debrids):

- `name` vira `Torrentio TB` (sufixo curto: `RD`, `PM`, `AD`, `DL`, `ED`, `OC`, `TB`, `Putio`, `HW`);
- entram `catalogs` do tipo `other` (`torrentio-torbox-torrents`, `-usenet`, `-webdl`, com `extra: [{name:"skip"}]`);
- entra o recurso `meta` com `types: ["other"]` e `idPrefixes` iguais às chaves dos debrids configurados;
- `debridoptions=nocatalog` remove catálogos e o `meta`.

Os catálogos por debrid: `torrentio-<moch>` para todos, exceto TorBox (3) e EasyDebrid/HighWay (nenhum).
O `background`/`logo` são montados a partir do `Host` da requisição, então o manifest não é um arquivo
estático.

## Stream

Exemplo real (`stream/movie/tt1254207.json`, recortado):

```json
{
  "name": "Torrentio\n1080p",
  "title": "Big Buck Bunny 1080p 30fps\n👤 25 💾 263.34 MB ⚙️ MagnetDL",
  "infoHash": "88594aaacbde40ef3e2510c47374ec0aa396c08e",
  "fileIdx": 0,
  "behaviorHints": {
    "bingeGroup": "torrentio|1080p",
    "filename": "bbb_sunflower_1080p_30fps_normal.mp4"
  }
}
```

Campos que o addon publica:

| Campo | Conteúdo |
|---|---|
| `name` | `Torrentio\n{qualidade [3D] [HDR|DV]}` |
| `title` | linha 1: título do torrent (vírgulas/espaços colapsados); linha 2: nome do arquivo, **só** quando difere do torrent; linha 3: `👤 {seeders} 💾 {tamanho} ⚙️ {provedor}`; linha 4: idiomas/bandeiras (`🇬🇧 / 🇵🇹`, `Dual Audio`) |
| `infoHash` | 40 hex, minúsculo; sempre presente nos streams de torrent |
| `fileIdx` | índice do arquivo no pack; ausente quando o banco não tem o índice do arquivo |
| `sources` | `tracker:{url}` por tracker + `dht:{infoHash}`; ausente quando o provedor não publica tracker |
| `behaviorHints.bingeGroup` | filme: `torrentio|{qualidade|fonte|codec|bitDepth|hdr}`; série com arquivo isolado: `torrentio|{qualidade|hdr|grupo}`; pack: `torrentio|{infoHash}` |
| `behaviorHints.filename` | nome do arquivo escolhido |
| `behaviorHints.videoSize` | tamanho em bytes (o Torrentio não usa; o tamanho vai no `title`) |
| `behaviorHints.videoHash` | hash do arquivo para casar legendas (não usado aqui) |
| `url` | só em streams de debrid e nos streams de erro (ver abaixo) |

Detalhes que afetam a integração:

- **Teto de 500** streams por resposta (SQL `LIMIT 500`). Não há `skip` para streams; a lista é "os 500
  melhores" segundo a config. `limit=999999` continua devolvendo 500 e `limit=0` é ignorado (500).
- Tipo não suportado (`tv`) ou id fora de `tt`/`kitsu` → `200 {"streams":[]}`. O `cache-control` desse caso
  sai malformado (`", public"`), sem `max-age`.
- Id `tt` inexistente → 200 vazio, com `cacheMaxAge: 60`.
- Títulos vêm com entidades HTML **sem decodificar** (`Can&#039;t`). Quem for escapar de novo precisa
  decodificar antes, senão a interface mostra `&#039;` literal.
- Torrents de anime e de provedores russos recebem trackers extras (lista pública `ngosang/trackerslist` +
  trackers fixos de anime/russo) no momento da resposta; por isso o número de `sources` varia.
- Quirk do banco: `tt0000000` devolveu 500 streams de EZTV de documentários, ou seja, id inválido pode
  casar com linha errada. O app deve sempre mostrar o título que o addon mandou, nunca assumir que o
  conteúdo é o do id pedido.

## Debrid

Fluxo (fonte: `application/addon.rs` e `providers/mod.rs`):

1. o addon consulta a disponibilidade do torrent no provedor (timeout de 30 s, circuit breaker);
2. torrent com cache no provedor vira um stream **sem** `infoHash`/`sources`, só com `url`:
   `{host}/resolve/{moch}/{api_key}/{entrada}/{filename}` e `name` prefixado `[RD+]` (curto do provedor);
3. torrent sem cache pode gerar um stream extra `[RD download]` (mesma URL de resolve; some com
   `debridoptions=nodownloadlinks`, nunca existe em EasyDebrid e é omitido para stream com 0 seeders,
   salvo 4k ou lista com ≤5 streams semeados);
4. o player abre `/resolve/…`, que responde **302** para o link do provedor (cache de 6 h) ou para um
   vídeo de erro quando o token é inválido/expirado/bloqueado/indisponível;
5. erros de token viram um stream jogável `name: "Torrentio\nRD error"`, `title` explicando o problema e
   `url` apontando para `/videos/failed_*`. Token inválido (< 15 caracteres, caractere não imprimível ou
   recusado pelo provedor) entra numa blacklist de até 20 mil entradas por processo.

O `resolve` carrega o token **no caminho**. No RealDebrid a entrada é `{api_key}/{info_hash}/null/{arquivo}`,
então a URL final contém a chave duas vezes. Isso é decisivo para nós: [hoje o DTO de streams devolve
`url` ao navegador](../../src/server/routes/stremio.ts), e um addon configurado com debrid vazaria a chave
para o cliente. Antes de suportar debrid de verdade, a URL de resolve precisa ser buscada/reescrita no
servidor (ou o addon precisa ser recusado).

### Catálogo e meta de debrid

- `catalog/other/torrentio-torbox-torrents.json/skip=…` → `{ "metas": [{ "id", "type": "other", "name" }], "cacheMaxAge": 0 }`.
  O `skip` vai como segmento de caminho (`…/skip=100.json`), não como query. RealDebrid pagina de 100 em
  100 (`page = skip/100 + 1`); TorBox repassa o `skip`.
- `meta/other/torbox:{id}.json` → `meta` com `id`, `type`, `name`, `infoHash`, `logo`, `poster`,
  `background`, `noCache` e `videos[]`. Cada vídeo tem `id` (`{imdb}:{temporada}:{episódio}` quando o
  arquivo foi enriquecido), `title`, `season`, `episode`, `released`, `thumbnail`, `size` e
  `streams: [{ url, behaviorHints: { bingeGroup: "{item}" } }]` com a URL já absoluta no host do addon.
- Sem chave válida, catálogo e meta respondem 404; com chave mas provedor fora do ar, o meta vem com
  `name: "Debrid provider is currently unavailable"` e `noCache: true`.

Esse `videos[].streams[]` é o que permite tocar arquivo por arquivo de um download; o parser atual do app
descarta esses campos (ver lacunas).

## Cache, erros e limites

| Situação | Corpo | `cache-control` |
|---|---|---|
| streams encontrados | `cacheMaxAge: 3600`, `staleRevalidate: 14400`, `staleError: 604800` | `max-age=3600, stale-while-revalidate=14400, stale-if-error=604800, public` |
| nenhum stream | `{"streams":[]}` com `cacheMaxAge: 60` | `max-age=60, …` |
| só vídeos estáticos de erro | `cacheMaxAge: 0` | `max-age=0, …` |
| tipo não suportado | `{"streams":[]}` sem `cacheMaxAge` | `, public` (sem `max-age`) |
| catálogo debrid | `cacheMaxAge: 0` | `max-age=0` |
| resolve | 302 | `max-age=21600` quando é URL de provedor; sem cache nos vídeos de erro |
| estáticos | arquivo | `public, max-age=31536000` |

Status: 404 para rota/recurso desconhecido, id vazio ou `.json` ausente; 500 com `{"err":"handler error"}`
para falha interna; 429 com texto fixo `Too many requests, please try again later.`; 401 no `/metrics`.

Rate limit (fonte: `infrastructure/ratelimit.rs`): 5.000 requisições de recurso (`stream`/`catalog`/`meta`)
por dia por IP, mais orçamento de "miss" (100) e "empty" (30) a cada 10 minutos, estes agrupados por
IPv6 `/64`; cliente com chave de debrid tem orçamento ×3. O modo de enforcement dos orçamentos é por
ambiente (`STREAM_BUDGET_MODE=enforce`).

Vídeos de erro publicados: `downloading_v3`, `download_failed_v3`, `failed_access_v3`, `failed_rar_v3`,
`failed_too_big_v2`, `failed_opening_v3`, `failed_unexpected_v3`, `failed_infringement_v3`,
`limits_exceeded_v2`, `blocked_access_v2`, `failed_unavailable_v1` (todos em `/videos/`).

## IDs e tipos

O `stream` aceita três tipos (`movie`, `series`, `anime`) e dois esquemas de id:

| Tipo | Formato | Exemplo |
|---|---|---|
| `movie` | `tt` + dígitos | `tt0111161` |
| `series` | `tt` + dígitos + `:temporada:episódio` | `tt0944947:1:1` |
| `anime` | `kitsu:` + dígitos, opcionalmente `:episódio` | `kitsu:1234`, `kitsu:1234:2` |

- `anime` com id `tt…` funciona (o mesmo filme/série é consultado no banco de IMDb); o tipo só muda a
  decisão de enriquecer trackers de anime.
- A checagem inicial é frouxa (procura `tt\d+`/`kitsu:\d+` em qualquer posição), mas a consulta ao banco é
  exata: id com lixo em volta passa e volta vazio.
- `other` não é aceito em `stream` (só existe em catálogo/meta de debrid) e devolve lista vazia.
- Tipo desconhecido (`tv`, `channel`, …) devolve 200 com lista vazia, sem erro.

## O que o nerd-watch já faz com isso

Teste real com o cliente do app (`parseAddonUrl` + `fetchManifestFrom` + `fetchStreams`):

```
manifestUrl: https://torrentio.strem.fun/providers=yts|sort=seeders|limit=3/manifest.json
baseUrl:     https://torrentio.strem.fun/providers=yts|sort=seeders|limit=3
manifest:    Torrentio 0.0.15 [ "stream" ] catalogs= 0
streams:     1
 - torrent | Torrentio / 4k HDR | c3da9a3d | The.Shawshank.Redemption.1994.2160p.4K.BluRay.x265.10bit.HDR.AAC5.1-[YTS.MX].mkv
```

E com série/anime:

```
series tt0944947:1:1 -> 2 streams; torrents= 2; trackers= 0; sample= Torrentio / 1080p
anime  kitsu:1234    -> 1 stream;  torrents= 1; trackers= 20; sample= Torrentio / 540p
```

Ou seja: **o link configurado do Torrentio já instala e toca**. A config fica no `baseUrl` (o app guarda
a URL do manifest, não o id do addon, então duas configurações do Torrentio convivem até o teto de 20).
O que funciona hoje: `stream` (url, youtube, external, torrent), `catalog` com `search`/`skip`, `meta`
(sem os `videos[].streams[]` do debrid), `infoHash` no motor P2P local, `fileIdx`, `bingeGroup`,
`filename`, `countryWhitelist`, `subtitleLangs`.

### Lacunas para as próximas integrações

| Lacuna | Efeito hoje | O que fazer |
|---|---|---|
| `meta.videos[].streams[]` descartado | catálogo/meta de debrid lista arquivos sem como tocar | estender `MetaVideo`/DTO e a tela do item |
| `url` de debrid vai crua ao cliente | token do debrid aparece no navegador | proxy/rewrite no servidor antes do DTO |
| `cacheMaxAge`/`staleRevalidate` do corpo ignorados | só o cache HTTP do `fetch` ajuda; sem cache próprio por addon | ler os campos e alimentar cache TTL local |
| `behaviorHints.configurable` descartado | não há botão "configurar" para o addon | guardar a flag e linkar `baseUrl + /configure` |
| `behaviorHints.videoHash` descartado | legenda externa não casa por hash de arquivo | guardar e usar na busca de legendas |
| `background` e `idPrefixes` do manifest descartados | tela do addon sem fundo; tipo `other` sem pistas de id | incluir no `AddonManifest` |
| catálogo `type: other` | UI atual é centrada em filme/série | mapear `other` para a lista de downloads do debrid |
| streams de erro são `url` normais | usuário abre um vídeo de aviso como se fosse o filme | detectar `/videos/failed_*` e mostrar como erro |
| títulos com `&#039;` | aparece a entidade literal depois do `escapeHtml` | decodificar entidades conhecidas antes de escapar |
| teto de 500 sem `skip` | listas longas parecem completas | avisar "500 melhores" e oferecer filtros (`qualityfilter`, `limit`) |
| ids `tt` errados podem casar | `tt0000000` devolveu outro conteúdo | confiar no título do addon e não no id |

### Receita para addons de torrent em geral

1. Trate a config como **caminho opaco**: guarde a URL do manifest e derive o `baseUrl` removendo só
   `/manifest.json`. Nunca reconstrua a config a partir de campos.
2. Toda URL que o addon devolve é dado de terceiro: valide http(s) público, mas lembre que o **caminho**
   pode conter segredo (debrid, token de painel). Não devolva ao navegador sem revisar.
3. Torrent é o caso fácil (`infoHash` + `sources`); o mesmo addon pode alternar para `url` quando há
   debrid, e o formato muda (sem `infoHash`).
4. `name`/`title` são heurísticos: guarde os dois crus e extraia só o que precisa (`👤`, `💾`, `⚙️`,
   bandeiras). Não descarte o original.
5. Respeite `cacheMaxAge` do corpo e os limites de taxa do addon; 500 streams e 100 itens por página são
   comuns em addons grandes.
6. Addons podem responder 200 com lista vazia, 200 com vídeo de erro e 200 com conteúdo de outro id —
   valide o que dá e mostre o resto como o addon mandou.

## Como reverificar

```bash
curl -s https://torrentio.strem.fun/manifest.json
curl -s "https://torrentio.strem.fun/providers=yts,eztv|sort=seeders|limit=2/manifest.json"
curl -s "https://torrentio.strem.fun/stream/movie/tt0111161.json" | head -c 500
curl -sI "https://torrentio.strem.fun/stream/movie/tt0111161.json"   # cache-control, HEAD
curl -s "https://torrentio.strem.fun/torbox=CHAVE/manifest.json"      # catálogos + meta
```

Medições desta rodada (para comparar depois): `tt0111161` → 500 streams (207 ThePirateBay, 68 1337x,
45 MagnetDL, 42 Rutor, 37 Rutracker…), 79 com `sources`, 0 com `url`; `tt0944947:1:1` → 500;
`kitsu:1234` → 5 com trackers de anime; `providers=yts` → 1; `limit=2` → 21 em 13 baldes;
`minseeders=20` → 29; `sizefilter=1GB,2GB` → 94 (filme, teto de 1 GB); `language=portuguese` → 500
reordenados.

## Fontes

- Produção: `https://torrentio.strem.fun/{manifest.json,configure,stream/…,catalog/…,meta/…,resolve/…}`.
- Código: `github.com/TheBeastLT/torrentio-scraper` — `addon/crates/addon/src/domain/{config,filter,sort,languages,stream,stream_info}.rs`,
  `http/{manifest,server}.rs`, `application/addon.rs`, `providers/{mod,options,static_videos}.rs`,
  `infrastructure/{magnet,ratelimit,repository}.rs`.
