<div align="center">

# 🍿 nerd-watch

**Controle o que você assistiu, está assistindo e quer assistir — filmes, séries e novelas, em streaming ou não.**

App local que junta catálogo (TMDB), domínio público de graça (Internet Archive, com player embutido
e torrent legal), calendário de lançamentos e progresso "onde parei", com spoilers sob demanda.

![Bun](https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-lint-60A5FA?logo=biome&logoColor=white)

</div>

---

## ✨ O que ele faz

| | |
|---|---|
| 🗂️ **Biblioteca** | quero ver / assistindo / assistido / abandonado, nota de 0 a 10, notas livres; abas com contagem, filtro por origem, grade ou lista e ações em lote |
| 🔖 **Onde você parou** | temporada e episódio atual por série, marcado com um clique |
| 🗓️ **Agenda** | próximos episódios e estreias de filme dos títulos que você acompanha, com faixa de 7 dias |
| ⌨️ **Ctrl K** | paleta de comandos (títulos, canais, ações) e atalhos `g`+letra (`?` mostra a lista) |
| 📺 **Episódios** | navegação por temporada, sinopse por episódio com **spoiler oculto por padrão** |
| 🎬 **Sinopse, nota e trailer** | via TMDB (filme e série) |
| 📡 **Onde assistir** | streamings disponíveis na sua região (TMDB watch/providers) |
| 🎞️ **Domínio público** | catálogo do Internet Archive (`feature_films`) — **assiste dentro do app**, sem chave nenhuma |
| 🧲 **Torrent legal** | o torrent oficial que a própria Archive.org gera para cada item de domínio público |
| ⚡ **Streaming P2P** | toca o torrent do acervo livre dentro do app, com seek — engine em processo, sem depender da banda do archive.org |
| 💬 **Legendas sem chave** | busca em addons do protocolo do Stremio (padrão: o OpenSubtitles v3 oficial) — **não precisa de cadastro nem de chave** |
| ✈️ **Canais do Telegram** | acompanhe vídeos de canais públicos; modos bot e conta pessoal são opcionais. Login por QR code guiado em **Conexões**, feed de novidades (carrossel com os 50 vídeos mais novos) e player fixo com fila e retomada |
| 📂 **Pastas do Google Drive** | aponte uma pasta de vídeos do **seu** Drive (acesso só leitura, login OAuth em **Conexões**) e assista aqui dentro, com a mesma fila, miniaturas e "continuar assistindo" dos canais. Toca MP4/H.264 e WebM (o navegador não toca MKV/AVI) |
| 🔌 **Fontes de vídeo** | pasta local, WebDAV, S3, Dropbox, OneDrive, Jellyfin/Emby, Plex, PeerTube, YouTube (embed) e torrent: cada pasta/biblioteca vira um canal, com a mesma fila, miniaturas e "continuar assistindo". Ver [Fontes de vídeo](#-fontes-de-vídeo) |
| 📚 **Mais catálogos** | **TVmaze** (séries e datas de episódios no calendário) e **AniList** (anime), sem chave; **Trakt** importa o que você já assistiu |
| ☁️ **Progresso no servidor** | "continuar assistindo" também fica no SQLite: sobrevive a limpar o navegador e vai no backup |
| 🔒 **Local-first** | sua lista e seu progresso ficam no `data/nerd-watch.db` (SQLite); consultas ao catálogo e ao Telegram usam os serviços externos correspondentes |

Filmes e séries **protegidos por direitos autorais não são reproduzidos dentro do app** — o app te leva
até o streaming legítimo. Só o acervo de domínio público (já livre de direitos) toca localmente.

O caminho de torrent **do acervo da Internet Archive** continua restrito por construção: ele só abre
torrents derivados de um item da Archive, e os trackers/web seeds declarados dentro do `.torrent` são
conferidos — se algum apontar para fora de `*.archive.org`, o item é recusado. Sem isso, um item
publicado por terceiro faria o servidor local buscar URLs escolhidas por quem publicou.

Há também a fonte **Torrent** (em [Fontes de vídeo](#-fontes-de-vídeo)), que aceita um magnet ou um
`.torrent` que **você** cola. Ela existe por decisão explícita do dono do app: não traz busca, indexador
nem lista de sites, descarta web seeds declarados no arquivo e só mostra o aviso de que você deve
assistir apenas o que tem direito. Desligue com `TORRENT_ENABLED=false`.

---

## 📸 Telas

Capturas da app em execução com o banco fictício criado por `bun run seed`. Nenhum dado pessoal foi usado.

![Página inicial com títulos fictícios em andamento e calendário](docs/screenshots/inicio.png)

| Biblioteca (antes "Minha lista") | Agenda (antes "Calendário") |
|---|---|
| ![Lista fictícia com filtros de acompanhamento](docs/screenshots/minha-lista.png) | ![Calendário de lançamentos dos títulos fictícios](docs/screenshots/calendario.png) |

Streaming P2P de um item de domínio público — `House on Haunted Hill` (1959), tocando direto do
torrent da Archive, com escolha do derivado e estatísticas de peer:

| Painel P2P | Tocando do torrent |
|---|---|
| ![Card "assistir por P2P" no detalhe do título](docs/screenshots/p2p-painel.png) | ![Filme tocando via torrent, com 5 peers e 2 MB/s](docs/screenshots/p2p-tocando.png) |

---

## 🚀 Rodando

```bash
bun install
cp .env.example .env      # opcional: adicione TMDB_API_KEY para o catálogo completo

bun run dev                # http://localhost:7799
```

Sem `TMDB_API_KEY` o app funciona normalmente para domínio público, sua lista e calendário — só a busca
por filmes/séries protegidos fica desligada (um aviso aparece na tela inicial). A chave é gratuita:
https://www.themoviedb.org/settings/api.

```bash
bun run seed     # popula data/nerd-watch.db com um catálogo fictício, só para ver a interface
```

### Docker

```bash
docker compose up -d --build     # http://localhost:7799
docker compose logs -f           # acompanha o boot
docker compose down              # para; os dados ficam no volume
```

- **Dados:** o SQLite e os torrents ficam no volume nomeado `nerd-watch-data` (`/app/data` dentro do
  container). `docker compose down -v` apaga tudo.
- **Segredos:** o compose lê `.env` se ele existir (`env_file` opcional), mas a imagem nunca inclui o `.env`
  (ver `.dockerignore`). Atenção: credenciais salvas pela própria UI (Telegram, Drive) são gravadas em
  `/app/.env` **dentro** do container; elas somem se o container for recriado. Para mantê-las, grave no
  `.env` do host e recrie o container com `docker compose up -d`.
- **Rede (modelo de segurança):** o container escuta em `0.0.0.0` só internamente (`HOST=0.0.0.0`), porque
  o port mapping chega pela interface do container. No host a porta é publicada como `127.0.0.1:7799`, então
  só a sua máquina alcança o app. Mesmo se você publicar em outra interface, o servidor recusa `Host` que
  não seja loopback (anti DNS rebinding) e `Origin` de outra origem em métodos que mudam estado (anti CSRF).
  Não remova o `127.0.0.1:` do `ports` sem entender isso.
- **Porta:** se o `.env` define `PORT`, ajuste o mapeamento do compose para a mesma porta.
- **Healthcheck:** a imagem checa `GET /api/health` a cada 30s; `docker compose ps` mostra `healthy`.
- **Usuário:** o processo roda como usuário `app` (não-root); só `/app/data` é gravável.
- Requer Docker Engine com Compose v2.24+ (para `env_file` com `required: false`).

### Como roda

```
Hono (Bun) — server local, só escuta em 127.0.0.1
  ├─ front  → public/  (bundle Bun: catálogo, calendário, player)
  ├─ SQLite → data/nerd-watch.db (sua lista, progresso, cache de episódios)
  ├─ torrents → .cache/torrents (engine WebTorrent em processo: acervo do Archive + o que você colar em Conexões)
  └─ providers → TMDB (com chave) + Internet Archive (sem chave) + Telegram (opcional) + Google Drive (opcional)
                 + legendas via addons do protocolo Stremio (sem chave)
```

### Legendas

A busca usa o **protocolo de addons do Stremio**, que é a parte reaproveitável daquele app: o addon
publica um `/manifest.json` e responde `GET {base}/subtitles/{movie|series}/{id}.json`. Um único
adaptador, em `providers/subtitles/stremio-addon.ts`, dá acesso a várias fontes sem scraper próprio.

O padrão é o addon oficial `https://opensubtitles-v3.strem.io` e **não exige chave nem cadastro** —
a `OPENSUBTITLES_API_KEY` virou opcional e só soma como segunda fonte. Para acrescentar outra fonte,
basta apontar `SUBTITLE_ADDONS` para ela.

Duas coisas que valem saber:

- O protocolo só responde por **id do IMDb** (`idPrefixes: ["tt"]`), então a busca traduz o id da
  TMDB para o do IMDb antes de perguntar (`tmdbExternalIds`).
- O download passa por um **proxy do próprio app** (`/api/subtitles/file`). O cliente manda fonte +
  id, nunca a URL de destino: o servidor reencontra a legenda numa busca cacheada e só fala com
  hosts que estão em `SUBTITLE_ADDONS`. Sem isso o endpoint seria um proxy aberto.

Aqui não existe `stream`/`catalog` do protocolo — só `subtitles`. Puxar addon de stream traria os
indexadores de catálogo comercial, que é justamente o que o app não faz.

O servidor valida `Host` (bloqueia DNS rebinding) e `Origin` em métodos que mudam estado (bloqueia CSRF),
no mesmo padrão de segurança usado no manga-lens.

### Telegram: credenciais e login

Canais em modo **público** funcionam sem nada. Para o modo **conta pessoal** (sem o teto de 20 MB por vídeo
da Bot API) o Telegram exige um `api_id` e um `api_hash`, que **você** gera uma vez:

1. Abra https://my.telegram.org e entre com o telefone da sua conta (o Telegram manda um código para o app).
2. Clique em **API development tools** e crie um app. O formulário pede título e nome curto; os demais
   campos são opcionais. Ao salvar, a página mostra o `api_id` (número) e o `api_hash` (32 caracteres).
3. No app, abra **Conexões → Telegram**, cole os dois valores e clique em **Salvar e continuar**.
4. Clique em **Entrar com QR code**. No celular: **Ajustes → Dispositivos → Conectar dispositivo** e aponte
   para o QR. Se a conta tem verificação em duas etapas, digite a senha quando o app pedir.
5. Pronto: adicione canais em **Canais** e escolha o modo "conta pessoal". **Encerrar sessão**, em Conexões,
   desloga também no Telegram.

Sem a interface, dá para preencher `TELEGRAM_API_ID` e `TELEGRAM_API_HASH` no `.env` e rodar
`bun run telegram:login` (o login por terminal grava `TELEGRAM_SESSION` do mesmo jeito).

- Os três valores ficam só no `.env` da sua máquina e nunca voltam para o navegador. Trate o `api_hash` e a
  `TELEGRAM_SESSION` como senha: a sessão dá acesso completo à conta.
- **Gere o seu próprio `api_id`/`api_hash` e não reutilize o de outra pessoa.** O par identifica o *seu* app
  no Telegram; compartilhá-lo expõe um segredo e junta os limites de uso de todo mundo no mesmo app.
- O app guarda **uma** conta por instância. Para duas pessoas, cada uma roda a própria cópia, com `.env`,
  `PORT` e `DB_PATH` próprios; um segundo login na mesma instância substitui a sessão anterior.
- "O Telegram recusou o api_id/api_hash" na tela de login significa valor errado: confira em
  https://my.telegram.org/apps e use **Corrigir credenciais**.
- **Canais e grupos privados** (sem @usuário) só funcionam no modo **conta pessoal**, e a conta precisa
  participar deles. Em **Canais**, cole o link de qualquer mensagem (ex.: `https://t.me/c/2675951342/7`, vale
  também com tópico) ou o id, ou abra **meus canais**: a lista traz canais e supergrupos, públicos e privados.
  O app guarda o canal como `c/<id>` e mostra o nome real. Grupos antigos (os que ainda não viraram
  supergrupo) não têm esse link e ficam de fora. Links de convite (`t.me/+…`) não servem: entre no canal pelo
  Telegram primeiro.
- **Histórico e busca:** ao importar, o app traz os 100 vídeos mais recentes (na prévia pública, a página que o t.me mostra). Na página
  do canal, **carregar vídeos mais antigos** lê a próxima página do Telegram, até o começo do histórico. O
  campo de busca filtra pelo título e pela descrição dos vídeos já carregados (sem diferenciar maiúsculas nem
  acentos); **buscar “…” no Telegram** procura no canal inteiro e acrescenta os achados à lista, no lugar
  certo pela data. Vale para conta pessoal e canal público; o modo bot só recebe o que for postado dali em diante.
- O **modo bot** é opcional: crie um bot com o @BotFather, cole o token em **Conexões → Telegram → Modo bot**
  e adicione o bot como admin do canal. Ele só vê posts de depois que foi adicionado.

---

## ✅ Verificação

```bash
bun run check   # lint (biome) + typecheck (tsc) + testes (bun test)
bun run smoke   # sobe o server numa porta separada e confere as rotas principais
```

Com o servidor rodando em outra aba, a PoC do streaming por torrent confere de ponta a ponta
(abertura, escolha do arquivo, `206` com `Content-Range`, seek e o recorte de segurança):

```bash
bun run poc:torrent                        # usa Sita_Sings_the_Blues (domínio público)
bun run poc:torrent -- house_on_haunted_hill_ipod
```

E a das legendas, que confere o caminho sem chave nenhuma contra o addon real:

```bash
bun run poc:subtitles                      # usa tt0111161 (filme)
bun run poc:subtitles -- tt0944947 tv      # série
```

---

## 🔌 Fontes de vídeo

Cada fonte é configurada em **Conexões** (ou no `.env`) e adicionada em **Canais**. Segredos ficam só no
`.env` (modo 0600) e nunca voltam para o navegador; a reprodução passa por um proxy no servidor.

| Fonte | Precisa de | Detalhes |
|---|---|---|
| Google Drive | OAuth (client ID/secret próprios) | [ADR](docs/adr/0001-google-drive-como-fonte.md) |
| Pasta local | `LOCAL_MEDIA_DIRS` no `.env` (somente leitura pela UI) | [docs](docs/providers/local.md) |
| WebDAV (Nextcloud, NAS) | URL, usuário e senha | [docs](docs/providers/webdav.md) |
| S3 compatível (AWS, MinIO, B2, R2) | endpoint, região, chaves | [docs](docs/providers/s3.md) |
| Dropbox | app key (OAuth PKCE, sem secret) | [docs](docs/providers/dropbox.md) |
| OneDrive pessoal | Application ID (OAuth PKCE, sem secret) | [docs](docs/providers/onedrive.md) |
| Jellyfin / Emby | URL e chave de API | [docs](docs/providers/jellyfin.md) |
| Plex | URL e token | [docs](docs/providers/plex.md) |
| PeerTube | nada | [docs](docs/providers/peertube.md) |
| YouTube (só embed) | nada | [docs](docs/providers/youtube.md) |
| Torrent (magnet / `.torrent` colado) | nada | [docs](docs/providers/torrent.md) |

Catálogos e sincronização: [TVmaze](docs/providers/tvmaze.md), [AniList](docs/providers/anilist.md),
[Trakt](docs/providers/trakt.md) e [progresso no servidor](docs/providers/progress-sync.md).

> **Honestidade sobre o que foi testado:** pasta local, PeerTube, YouTube, TVmaze e AniList foram
> exercitados contra o serviço real. Google Drive, WebDAV, S3, Dropbox, OneDrive, Jellyfin, Plex e Trakt
> só contra serviços simulados e a documentação oficial — exigem conta/servidor, então o primeiro uso
> real é a validação. Cada doc lista o que não foi confirmado.
> **Torrent** tem importação por `.torrent` verificada de verdade, mas a reprodução ponta a ponta não foi
> provada: itens que dependem de *web seeds* (comum na Internet Archive) não tocam por esta fonte porque
> ela descarta web seeds de propósito — veja [a doc](docs/providers/torrent.md).

---

## Limites conhecidos

- **Sem empacotamento desktop** (Tauri) nesta primeira versão — roda como app web local. Fica como
  próximo passo se fizer sentido.
- **Sem cache de metadados da TMDB** — cada visita a um título busca a temporada/episódio ao vivo (fica
  cacheado no SQLite conforme você visita, mas não há refresh automático).
- **Domínio público limitado à coleção `feature_films`** da Internet Archive — é a curadoria oficial
  deles para conteúdo livre; dá para ampliar depois se quiser mais fontes.
- **O torrent começa pelo derivado mais leve** (`_512kb`/`small`) para o vídeo abrir rápido, não pela
  melhor qualidade — o seletor na tela deixa você trocar para `large`/`1080p` a qualquer momento.
- **Só MP4/WebM tocam no navegador.** Itens da Archive que só têm `.ogv`/`.avi`/`.mkv` aparecem sem o
  player P2P (o download do torrent continua lá).
- **O torrent baixa adiantado enquanto está aberto.** É o comportamento do engine (medido: ~50 MB em
  20s mesmo sem nenhuma leitura), e é o mesmo de qualquer cliente P2P com buffer. O consumo é
  limitado por três coisas: fechar o painel, sair da tela, e o sweeper que derruba o torrent sem
  leitura por `TORRENT_IDLE_MINUTES` (padrão 10) — aí o disco é liberado.
