# TVmaze

Catálogo de séries e datas de exibição de episódios. Alimenta a busca, a página de detalhe e o calendário (Agenda) junto com TMDB e Internet Archive.

- **Chave:** não exige. Não há variável de ambiente.
- **Endpoints usados:** `GET /search/shows?q=`, `GET /shows/:id?embed=episodes`.
- **Limite documentado:** pelo menos 20 chamadas a cada 10 s por IP. O app aplica esse teto localmente (`src/server/lib/rate-limit.ts`): chamada além do limite falha na hora com mensagem de "tente de novo", sem sair para a rede.
- **Cache:** busca 15 min, detalhe 60 min (memória do processo; erros não são cacheados).
- **Timeout:** 10 s por chamada.

## Atribuição e licença

Os dados são da TVmaze sob **CC BY-SA**: podem ser usados livremente desde que a TVmaze seja creditada como fonte. O app mostra o crédito com link na página de detalhe ("Dados: TVmaze, licença CC BY-SA"). A resposta de `/api/tvmaze/:id` traz o campo `attribution` com o mesmo texto.

## Rotas do app

| Rota | Uso |
| --- | --- |
| `GET /api/tvmaze/search?q=` | resultados da busca direta |
| `GET /api/tvmaze/:id` | grava título, temporadas e episódios (com data) e devolve o detalhe |
| `GET /api/tvmaze/person/:id/card` | cartão do elenco: dados da pessoa, até 12 outras séries (castcredits, cache 6h) e mini bio da Wikipedia |

A busca unificada (`GET /api/search`) já inclui os resultados da TVmaze, com o selo "série · TVmaze".

## Mini bio (Wikipedia)

O modal de elenco busca a bio no resumo REST da Wikipedia (`pt`, depois `en`), com User-Agent próprio, cache de 24h e limite de 30 pedidos a cada 10s. Só aceita página do tipo `standard` cujo texto fale de trabalho em tela (ator, atriz, actor, comedian...), para não mostrar homônimos. O texto é CC BY-SA e vem com crédito e link. Sem bio confiável, ou se a Wikipedia recusar (429), o cartão vem com `bio: null` e o modal diz isso.

## Limites conhecidos

- A TVmaze só cobre TV: filmes não aparecem em "Outras séries".

- Episódio sem número (especiais sem numeração) não é gravado: não há chave para ele na tabela de episódios.
- Data de exibição fora do formato `AAAA-MM-DD` é descartada; o episódio aparece sem data e fica fora do calendário.
- Imagens e site oficial só são aceitos em `https:`; qualquer outro esquema vira ausência de imagem.
- Todos os episódios de uma série vêm numa única resposta. Séries muito longas geram um payload maior, mas o volume é limitado pelo próprio catálogo da TVmaze.
