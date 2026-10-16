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
| 🗂️ **Sua lista** | quero ver / assistindo / assistido / abandonado, nota de 0 a 10, notas livres |
| 🔖 **Onde você parou** | temporada e episódio atual por série, marcado com um clique |
| 🗓️ **Calendário** | próximos episódios e estreias de filme, só dos títulos que você acompanha |
| 📺 **Episódios** | navegação por temporada, sinopse por episódio com **spoiler oculto por padrão** |
| 🎬 **Sinopse, nota e trailer** | via TMDB (filme e série) |
| 📡 **Onde assistir** | streamings disponíveis na sua região (TMDB watch/providers) |
| 🎞️ **Domínio público** | catálogo do Internet Archive (`feature_films`) — **assiste dentro do app**, sem chave nenhuma |
| 🧲 **Torrent legal** | o torrent oficial que a própria Archive.org gera para cada item de domínio público |
| ⚡ **Streaming P2P** | toca o torrent do acervo livre dentro do app, com seek — engine em processo, sem depender da banda do archive.org |
| ✈️ **Canais do Telegram** | acompanhe vídeos de canais públicos; modos bot e conta pessoal são opcionais |
| 🔒 **Local-first** | sua lista e seu progresso ficam no `data/nerd-watch.db` (SQLite); consultas ao catálogo e ao Telegram usam os serviços externos correspondentes |

Filmes e séries **protegidos por direitos autorais não são reproduzidos dentro do app** — o app te leva
até o streaming legítimo. Só o acervo de domínio público (já livre de direitos) toca localmente.

O motor de torrent segue a mesma regra por construção: ele **só abre torrents derivados de um item
da Internet Archive**. Não existe endpoint que aceite magnet ou `.torrent` arbitrário, e os
trackers/web seeds declarados dentro do próprio `.torrent` são conferidos — se algum apontar para
fora de `*.archive.org`, o item é recusado. Sem isso, um item publicado por terceiro no acervo
aberto da Archive faria o servidor local buscar URLs escolhidas por quem publicou. Com isso, o app
não tem como virar um player de catálogo comercial — a engine, o streaming com seek e o player são
os mesmos que qualquer app do tipo usaria, mas a fonte é sempre o acervo livre.

---

## 📸 Telas

Capturas da app em execução com o banco fictício criado por `bun run seed`. Nenhum dado pessoal foi usado.

![Página inicial com títulos fictícios em andamento e calendário](docs/screenshots/inicio.png)

| Minha lista | Calendário |
|---|---|
| ![Lista fictícia com filtros de acompanhamento](docs/screenshots/minha-lista.png) | ![Calendário de lançamentos dos títulos fictícios](docs/screenshots/calendario.png) |

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

### Como roda

```
Hono (Bun) — server local, só escuta em 127.0.0.1
  ├─ front  → public/  (bundle Bun: catálogo, calendário, player)
  ├─ SQLite → data/nerd-watch.db (sua lista, progresso, cache de episódios)
  ├─ torrents → .cache/torrents (engine WebTorrent em processo, só acervo livre)
  └─ providers → TMDB (com chave) + Internet Archive (sem chave) + Telegram (opcional)
```

O servidor valida `Host` (bloqueia DNS rebinding) e `Origin` em métodos que mudam estado (bloqueia CSRF),
no mesmo padrão de segurança usado no manga-lens.

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
