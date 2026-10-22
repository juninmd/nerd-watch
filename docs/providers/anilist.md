# AniList

Catálogo de anime. Entra na busca unificada (selo "anime · AniList") e tem página de detalhe própria.

- **Chave:** não exige. Não há variável de ambiente.
- **Endpoint:** `POST https://graphql.anilist.co` (GraphQL). As consultas são constantes; o termo digitado vai só em `variables`, nunca na string da consulta.
- **Limite:** o guia de rate limiting do AniList documenta 90 req/min, mas informa que o serviço está em estado degradado com 30 req/min. O app usa **30 req/min** (o teto mais baixo), aplicado localmente. Acima disso a chamada falha com mensagem de "tente de novo" e não sai para a rede.
- **Cache:** busca 15 min, detalhe 60 min.
- **Timeout:** 10 s por chamada.

## Rotas do app

| Rota | Uso |
| --- | --- |
| `GET /api/anilist/search?q=` | busca direta (máx. 12 resultados, termo de até 200 caracteres) |
| `GET /api/anilist/:id` | grava o título e o próximo episódio; devolve o detalhe |

## Próximo episódio

O AniList informa apenas o **próximo episódio** (`nextAiringEpisode`), não a lista completa. Esse episódio é gravado na temporada 1 do app (cada temporada/cour do AniList é uma entrada própria) e aparece na Agenda. A data é o dia local do horário de exibição. Episódios já exibidos continuam na tabela com data passada e saem da Agenda sozinhos.

## Limites conhecidos

- A página de detalhe não tem lista de episódios: o AniList não a fornece.
- Trechos marcados pelo AniList como spoiler (`~! ... !~`) são **descartados** da sinopse, não só escondidos.
- A sinopse vem sem formatação HTML; alguns asteriscos de lista do markdown do AniList podem aparecer como texto.
- Conteúdo adulto é excluído na consulta de busca (`isAdult: false`).
- Filme de anime (`format = MOVIE`) vira título do tipo filme e entra na Agenda pela data de estreia (só o ano é gravado, então a data é 1º de janeiro).
- Os termos de uso do AniList não foram verificados nesta entrega; a fonte é creditada na página ("ver no AniList").
