# Pular abertura e créditos (IntroDB e AniSkip)

O player do episódio pergunta ao servidor onde ficam abertura, recapitulação e créditos:
`GET /api/skip-times?imdbId=&tmdbId=&season=&episode=&title=&duration=`.

| Fonte | Quando | Chave |
|---|---|---|
| [IntroDB](https://introdb.app) | séries com IMDb (direto ou pelo `tmdbId` via TMDB) | não |
| [AniSkip](https://aniskip.com) | anime: temporada 1 ou filme, com o id do MyAnimeList (`idMal`) achado pelo título no AniList | não |

- Resposta cacheada por 6 horas no servidor; falha de uma fonte só deixa o botão de fora.
- Sem tempos, o player funciona igual: não há botão nem marcas na barra.
- Com vários envios para o mesmo trecho, o AniSkip fica com o de duração (`episodeLength`) mais próxima do vídeo (`duration`).
- Testes sem rede: `setSkipTimesFetchForTests` em `src/server/providers/skip-times/index.ts`.
