# Importadores da biblioteca: CSV e MyAnimeList

Não é fonte de vídeo. Mexe só na sua lista (`library_entries`), pelo cartão **Biblioteca em planilha** em
**Conexões**, ou pelas rotas abaixo.

## Rotas

| Método | Rota | Entrada | Teto | Resposta |
|---|---|---|---|---|
| GET | `/api/library/export.csv` | — | — | CSV (`text/csv; charset=utf-8`, anexo `nerd-watch-biblioteca.csv`) |
| POST | `/api/library/import.csv` | corpo CSV em UTF-8 | 1 MiB e 2000 linhas | `{ imported, updated, unchanged, failed, errors: [{ row, message }] }` |
| POST | `/api/library/import.mal` | corpo XML do MyAnimeList | 5 MiB e 5000 entradas | `{ entries, imported, updated, unchanged, unresolved: [{ row, malId, title, watchStatus }], errors }` |

Erros de arquivo: `400` (formato, cabeçalho, aspas, XML inválido) e `413` (acima do teto). Erros de linha
ou de entrada não derrubam o arquivo: vêm em `errors` com o número da linha e as outras são gravadas.

## CSV

Formato RFC 4180. A exportação escreve CRLF, aspas só onde o formato exige, e um BOM UTF-8 no início (é o que
faz o Excel ler acentos). A importação aceita CRLF ou LF, com ou sem BOM, e ignora linhas em branco.

```csv
title,year,type,status,rating,current_season,current_episode,notes,tmdb_id,added_at
"Filme, com vírgula",1999,movie,watched,9,,,"linha 1
linha 2",101,2026-01-02T03:04:05.000Z
```

| Coluna | Valores | Obrigatória na importação |
|---|---|---|
| `title` | texto, até 300 caracteres | sim |
| `type` | `movie` ou `tv` | sim |
| `status` | `want`, `watching`, `watched`, `dropped` (os mesmos do app) | sim |
| `year` | 4 dígitos. Só sai na exportação (do ano de lançamento) e só serve para casar | não |
| `rating` | inteiro de 0 a 10, vazio = sem nota | não |
| `current_season` / `current_episode` | inteiros, vazio = sem progresso | não |
| `notes` | texto, até 5000 caracteres | não |
| `tmdb_id` | inteiro positivo | não (ver "como as linhas casam") |
| `added_at` | data ISO. Exportada, ignorada na importação | não |

Nomes de coluna não diferenciam maiúsculas. Colunas extras são ignoradas. Se faltar `title`, `type` ou `status`
no cabeçalho, o arquivo inteiro é recusado (400). Linha com número de colunas diferente do cabeçalho vira erro
dessa linha.

### Como as linhas casam (sem inventar identidade)

1. **Com `tmdb_id`:** o título é o de origem TMDB com esse id. Se não existir, é criado com o nome da linha, sem
   chamar a TMDB. Se o id já existir como outro tipo (filme x série), a linha é erro.
2. **Sem `tmdb_id`:** casa com um título que **já está na sua biblioteca** pelo nome, tipo e ano (sem diferença
   de maiúsculas, espaços nas pontas ou forma Unicode). Sem correspondência, ou com mais de uma, é erro: o app
   não cria título sem identidade.

Consequência para backup: exportar e importar num banco vazio traz de volta os títulos da TMDB. Títulos de
Internet Archive, TVmaze ou AniList não têm `tmdb_id` no arquivo, então voltam como erro de linha.

### Idempotência

O arquivo é o estado final: `status`, `rating`, `notes` e o progresso de cada linha são gravados como estão.
Reimportar o mesmo arquivo não cria nada duplicado e conta tudo em `unchanged`. Duas linhas do mesmo título no
mesmo arquivo: a segunda é erro ("linha duplicada").

Não volta na importação: `added_at` (é o momento em que a entrada entra na lista) e o ano de títulos criados
pelo CSV (eles só ganham data de lançamento quando há metadados).

### Proteção contra injeção de fórmula

Célula que começa com `=`, `+`, `-`, `@`, tab ou CR, ou com espaço seguido de um desses, sai com um apóstrofo na
frente, para o Excel, o Calc ou o Sheets não executarem como fórmula. Um texto que já começa com apóstrofo
também ganha um, para a importação saber distinguir.

A importação tira **só** esse apóstrofo, e só quando o resto da célula é o que precisava da marca. Um título
como `'Til Death` (sem marca) entra intacto. Limite conhecido: um texto que alguém escreveu à mão como `'=…`
perde o apóstrofo na importação.

## MyAnimeList (XML)

Lê a exportação da lista de anime do MyAnimeList (`<myanimelist>` com um `<anime>` por entrada). O formato foi
conferido só contra o esquema documentado, sem uma exportação real. Usa quatro campos:

| Campo do MAL | Uso |
|---|---|
| `series_animedb_id` | id do MyAnimeList. Obrigatório, é a única identidade usada |
| `series_title` | só para mostrar no relatório. Nunca usado para casar títulos |
| `my_status` | mapeado abaixo. Obrigatório |
| `my_score` | nota de 1 a 10. `0` ou vazio = sem nota (não apaga a nota que já existe) |

| `my_status` (MAL) | Status no app |
|---|---|
| Watching | `watching` |
| Completed | `watched` |
| On-Hold | `watching` (o app não tem "pausado"; o título segue em andamento) |
| Dropped | `dropped` |
| Plan to Watch | `want` |

Comparação sem diferença de maiúsculas. `my_watched_episodes` não é gravado: o MAL conta episódios por entrada,
o app conta por temporada, e converter seria chutar.

### Por que quase tudo volta como "sem correspondência"

O app não tem como saber, offline, qual título da sua lista é qual entrada do MAL. Títulos do AniList guardam
o id do AniList, que é outro número, e nada no repositório guarda o `idMal`. Por isso o importador **não chuta**:
o padrão (`resolveMalTitleOffline`) não resolve nenhuma entrada, todas aparecem em `unresolved`, e nada é
gravado. A função de resolução é injetada no módulo, então um mapeamento real pode ser plugado depois sem mexer
no leitor do XML. Esse mapeamento ainda não existe; ver "Próximo" no README.

### Segurança do XML

- DOCTYPE e qualquer declaração `<!...>` são recusados antes de qualquer leitura: sem entidade externa, sem
  busca de DTD, sem expansão de entidade (ataques XXE e "billion laughs").
- Leitor próprio do repositório (`providers/xml/minixml.ts`), sem dependência nova, com teto de profundidade
  (40) e de nós (50 mil).
- Teto de 5 MiB medido enquanto o corpo é lido, não só pelo cabeçalho `Content-Length`.

## Testes

Todos sintéticos (nomes e ids fictícios), em `tests/`:

- `library-csv-format.test.ts`: RFC 4180 (vírgula, aspas, quebra de linha, unicode, BOM, aspa sem fechamento) e
  neutralização de fórmula.
- `library-csv.test.ts`: ida e volta, injeção de fórmula ponta a ponta, linhas malformadas e inválidas,
  colisão de tipo, casamento sem id, idempotência e teto de linhas.
- `library-mal.test.ts`: mapeamento, campos ausentes, DOCTYPE, ENTITY, XML malformado e raiz errada.
- `library-io-route.test.ts`: rotas, `413` com e sem `Content-Length`, UTF-8 inválido e a recusa do DOCTYPE
  pela rota.
- `library-io-regressions.test.ts`: colunas ausentes que não apagam dados, casamento sem ano, separador `;`,
  linhas vazias, CR sozinho e MAL com 5000 entradas.
- `library-io-report.test.ts`: textos do relatório na tela.

Colunas ausentes na importação significam "não mexer" (não "apagar"). Coluna presente com célula vazia limpa o valor.

## O que não foi provado

- Nenhuma exportação real do MyAnimeList foi testada. O formato segue o esquema documentado.
- Nenhuma planilha real (Excel, Calc, Sheets) foi aberta para conferir a neutralização. Os testes conferem o
  texto do arquivo, não o que a planilha mostra.
- A importação do MAL não grava nada sem um mapeamento MAL -> título, que ainda não existe.
