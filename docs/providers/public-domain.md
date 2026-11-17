# Domínio público (fontes e licenças)

A tela **Domínio público** lista só fontes que publicam a licença de cada item. Sem conta, sem chave.

| Fonte | O que traz | Licença | Como toca |
|---|---|---|---|
| Internet Archive `feature_films` | longas clássicos | curadoria da Archive como domínio público / licença livre | MP4/WebM direto, embed da Archive ou P2P |
| Internet Archive `silent_films` | cinema mudo | idem (acervo de filmes mudos) | idem |
| Internet Archive `prelinger` | filmes de arquivo (publicidade, educação, indústria) | Prelinger Archives, sem restrição conhecida | idem |
| Internet Archive `nasa` | vídeos da NASA | mídia da NASA, em geral sem copyright (confira o item) | idem |
| Wikimedia Commons | vídeos livres, incluindo os filmes abertos da Blender Foundation | cada arquivo mostra a própria licença (PD, CC0, CC BY, CC BY-SA); a CC BY exige atribuição, por isso o autor aparece | `<video>` direto do `upload.wikimedia.org` |

- A lista de coleções da Archive é **fechada** (`PUBLIC_DOMAIN_COLLECTIONS` em `providers/archive.ts`); o `collection` da query é validado contra ela. Coleções abertas a upload (`opensource_movies`, `community`) ficam de fora de propósito.
- Commons: a API exige `User-Agent` identificável. Só entram arquivos de vídeo servidos por `upload.wikimedia.org`. Itens `.ogv` podem não tocar em alguns navegadores (há botão para baixar).
- As quatro coleções da Archive foram conferidas na API real (todas devolvem vídeos). **A API do Commons não foi exercitada ao vivo** (a rede da sessão levou rate limit): está coberta por testes com `fetch` falso.

## Avaliadas e não incluídas

- **Library of Congress (loc.gov):** os direitos variam por item e a API não foi verificada; entra quando houver um filtro de "sem restrições conhecidas" confirmado.
- **YouTube "domínio público":** não há como provar a licença por item sem a Data API com chave.
- **Public Domain Torrents:** o app só abre torrents da Internet Archive por desenho (ver `torrent/engine.ts`), e a disponibilidade do site não foi verificada.
