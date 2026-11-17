# Domínio público (fontes e licenças)

A tela **Domínio público** lista só fontes que publicam a licença de cada item. Sem conta, sem chave.

| Fonte | O que traz | Licença | Como toca |
|---|---|---|---|
| Internet Archive `feature_films` | longas clássicos | curadoria da Archive como domínio público / licença livre | MP4/WebM direto, embed da Archive ou P2P |
| Internet Archive `silent_films` | cinema mudo | idem (acervo de filmes mudos) | idem |
| Internet Archive `prelinger` | filmes de arquivo (publicidade, educação, indústria) | Prelinger Archives, sem restrição conhecida | idem |
| Internet Archive `nasa` | vídeos da NASA | mídia da NASA, em geral sem copyright (confira o item) | idem |
| Internet Archive `Film_Noir` | film noir | curadoria da Archive (Moving Image Archive) | idem |
| Internet Archive `SciFi_Horror` | ficção científica e terror clássicos | idem | idem |
| Internet Archive `moviesandfilms` | filmes em geral | **só itens com `licenseurl` de domínio público/CC0** (declaração de quem enviou) | idem |
| Internet Archive `animationandcartoons` | animação, desenhos, brickfilms | idem (filtro de licença) | idem |
| Internet Archive `classic_cartoons` | desenhos clássicos (Film Chest) | idem (filtro de licença) | idem |
| Internet Archive `classic_tv` | séries e TV clássica | idem (filtro de licença) | idem |
| Wikimedia Commons | vídeos livres, incluindo os filmes abertos da Blender Foundation | cada arquivo mostra a própria licença (PD, CC0, CC BY, CC BY-SA); a CC BY exige atribuição, por isso o autor aparece | `<video>` direto do `upload.wikimedia.org` |

- A lista de coleções da Archive é **fechada** (`PUBLIC_DOMAIN_COLLECTIONS` em `providers/archive.ts`); o `collection` da query é validado contra ela. Coleções abertas a upload (`opensource_movies`, `community`) ficam de fora de propósito.
- Commons: a API exige `User-Agent` identificável. Só entram arquivos de vídeo servidos por `upload.wikimedia.org`. Itens `.ogv` podem não tocar em alguns navegadores (há botão para baixar).
- Coleções de envio livre (`moviesandfilms`, `animationandcartoons`, `classic_cartoons`, `classic_tv`) recebem o filtro `PUBLIC_DOMAIN_LICENSE_CLAUSE`: `licenseurl` em `publicdomain/mark/1.0`, `licenses/publicdomain` ou `publicdomain/zero/1.0`. Medido na API real (2026-11-17): Film_Noir cai de 1660 para 188 itens com o filtro, `classic_tv` tem 2125, `animationandcartoons` 541, `moviesandfilms` 7723. A marcação é do uploader; a Archive não a audita, por isso o rótulo diz "licença livre marcada".
- As coleções originais da Archive (feature_films, silent_films, prelinger, nasa) da Archive foram conferidas na API real (todas devolvem vídeos). **A API do Commons não foi exercitada ao vivo** (a rede da sessão levou rate limit): está coberta por testes com `fetch` falso.

## Avaliadas e não incluídas

- **Library of Congress (loc.gov):** os direitos variam por item e a API não foi verificada; entra quando houver um filtro de "sem restrições conhecidas" confirmado.
- **YouTube "domínio público":** não há como provar a licença por item sem a Data API com chave.
- **Public Domain Torrents:** o app só abre torrents da Internet Archive por desenho (ver `torrent/engine.ts`), e a disponibilidade do site não foi verificada.

## Avaliadas nesta rodada e não incluídas

- **Archive `educationalfilms`:** só 5 itens com licença livre marcada; não compensa uma aba.
- **Archive `opensource_movies`, `artsandmusicvideos`, `vlogs`, `gamevideos`, `home_movies`, `newsandpublicaffairs`:** envio aberto, conteúdo de usuário; mesmo com o filtro de licença o volume é de material pessoal, não de acervo. Fora de propósito.
- **Archive `ephemera`, `classic_tv_commercials`:** mistura de tipos / comerciais curtos; sem valor de catálogo.
- **Library of Congress (revisitada):** a API `loc.gov/film-and-videos/?fo=json` responde, mas os resultados de vídeo são em boa parte webcasts do próprio LoC e a listagem não traz direito por item de forma confiável. Segue fora.
- **Vimeo CC0:** API exige token de acesso; sem chave no desenho do app.
- **Europeana e DPLA:** exigem chave de API (DPLA devolveu 403 sem chave).
- **Openverse:** só imagem e áudio (sem vídeo); anônimo levou 403 da rede da sessão e o app não tem player de áudio.
- **LibriVox (audiolivros) e podcasts:** a API responde (200) e o acervo é domínio público, mas o app não tem player/catálogo de áudio; fora do escopo até existir.
- **Blender open movies:** já cobertos pelo Commons e pelo canal PeerTube `blender_open_movies@video.blender.org` (ver `peertube.md`).
