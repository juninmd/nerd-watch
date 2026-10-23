# ADR 0003: vínculo entre vídeo do canal e título da biblioteca

Status: aceito (fase 1). TMDB como fonte de sugestão ficou para a fase 2.

## Contexto

Um vídeo de canal do Telegram é só uma linha na lista. Para ele alimentar "Onde parei", "Próximos episódios" e a
agenda, precisa apontar para um episódio que o app conhece. O nome do arquivo ou a legenda dizem título, ano,
temporada e episódio (ver `docs/providers/telegram-names.md`), mas esse texto é livre e pode casar com o título
errado. Errar um vínculo polui o progresso do usuário, então a regra é: na dúvida, não vincular.

## Decisão

1. **Colunas aditivas e nulas em `telegram_items`:** `title_id` (FK com `ON DELETE SET NULL`), `season_number`,
   `episode_number`, `episode_end`, `link_status` (`suggested` | `linked`), `link_source` (`auto` | `manual`) e
   `link_confidence`. Entram pelo padrão `ADD COLUMN` idempotente (`src/server/db-migrations-telegram-links.ts`).
   Sem tabela nova: o vínculo é um atributo do vídeo, e um vídeo tem no máximo um vínculo.
2. **Matcher determinístico** (`src/server/media-name/match.ts`), sem rede e sem LLM. Só casa com títulos da
   biblioteca (séries). Pontuação: 0,5 por título exato (sem acento, caixa ou pontuação); +0,3 se o ano do nome
   bate com o da biblioteca; +0,2 se a temporada veio escrita no nome. Ano diferente elimina o título (remake).
   - `linked` automático só com 1,0 (ano e temporada batendo). Sem isso, é `suggested` (0,5 a 0,8), e o usuário confirma.
   - Empate no topo = `ambiguous`: fica sem vínculo.
   - Número sem temporada (anime): se a série tem uma temporada só, ela vale; com várias, o número é absoluto
     (contado na ordem das temporadas). Nunca vincula sozinho (0,5 ou 0,8).
   - Intervalo (`S01E01-E03`): vincula o início e guarda o fim; exige todos os episódios no banco.
3. **Decisão manual é soberana.** `link_source = 'manual'` nunca é reprocessado pelo automático. "Sem vínculo" grava
   `manual` sem título, então o vídeo não volta a ser sugerido.
4. **Progresso** (`src/server/repo/telegram-link-progress.ts`): ao `PUT /api/playback` com 95% da duração (ou
   `done`), um vídeo `linked` avança o marcador via `markProgressThrough` (que já grava histórico). Nunca regride:
   alvo igual ou anterior ao marcador não grava. A resposta traz `progress` com o estado anterior e o id da entrada,
   para o desfazer do cliente. O limiar 95% espelha `FINISHED_RATIO` do cliente.
5. **Próximos episódios:** para cada série listada, uma consulta extra devolve o vídeo `linked` do próximo episódio
   (`channelVideo`). O card leva ao vídeo, não à série.
6. **Agenda:** nada novo.

## Alternativas consideradas

- **Tabela `telegram_item_title` separada:** mais normalizada, mas um vídeo tem no máximo um vínculo e a leitura em
  "Próximos episódios" ficaria com join extra. Rejeitada por custo sem ganho.
- **Casar com TMDB direto:** exige criar título e buscar episódios antes de vincular; a fase 1 não precisa disso
  para ser útil (o usuário já tem a série na biblioteca). Fica para a fase 2, com cache e limite por lote.
- **Vincular por LLM:** não determinístico, custa token, e o conteúdo do canal não deve sair para serviço externo.

## Consequências

- Importação ganha uma consulta de candidatos e um `UPDATE` por vídeo novo (só os `messageIds` recém-gravados).
  Páginas antigas não reprocessam o canal inteiro.
- Vídeos de qualquer fonte que use `telegram_items` (Drive, WebDAV, pasta local) também recebem vínculo. O
  mecanismo é o mesmo; a UI fica na página do canal.
- Mudar o matcher não reescreve vínculos antigos automáticos até o próximo recálculo (abrir o canal ou importar).

## Limites conhecidos (fase 1)

- **Sem dedupe por arquivo.** Mesmo documento e tamanho em dois canais: o Up Next usa o primeiro postado, mas o banco
  não guarda o id do documento nem o tamanho. Exige colunas novas e leitura do MTProto em `personal.ts`.
- **Sem fonte TMDB para sugestão.** Só títulos já na biblioteca.
- **Rollback:** `ALTER TABLE telegram_items DROP COLUMN` por coluna. Nada fora do vínculo depende delas.
