# Nomes de vídeo do Telegram: `parseMediaName`

Interpreta o nome de arquivo ou a legenda de um vídeo e devolve título, ano, temporada, episódio e tags de release.
Função pura e determinística: sem rede, sem LLM, sem estado. O vínculo com a biblioteca usa este parser (ver `docs/adr/0003-vinculo-canal-titulo.md`): o casamento e a decisão
ficam em `src/server/media-name/match.ts`. O casamento com TMDB como sugestão ainda não existe.

- **Código:** `src/server/media-name/parse.ts` (API), `match.ts` (vínculo com a biblioteca), `tags.ts` (vocabulário), `structure.ts` (temporada, episódio, fim do título), `clean.ts` (ruído de canal).
- **Testes:** `tests/media-name-parse.test.ts`, com o corpus sintético em `tests/fixtures/media-name-corpus.ts` (nomes inventados).

## Uso

```ts
import { parseMediaName } from '../src/server/media-name/parse.ts';

parseMediaName('Show.Name.S01E02.1080p.WEB-DL.x264.mkv');
// { title: 'Show Name', season: 1, episode: 2, resolution: '1080p', source: 'WEB-DL', codec: 'H.264' }

parseMediaName('T02E03 Nome', { seriesTitle: 'Minha Serie' });
// { title: 'Minha Serie', season: 2, episode: 3 }
```

## Campos

| Campo | Tipo | Significado |
| --- | --- | --- |
| `title` | `string` | Sempre presente. Vazio quando o texto não traz título e não há `seriesTitle`. |
| `year` | `number` | Ano entre parênteses, ou o último ano solto antes de tags/fim. |
| `season`, `episode` | `number` | `S01E02`, `1x02`, `Temporada 2 Episódio 3`, `T02E03`, `Temp 1 Cap 12`, `Title - 12` (anime). |
| `episodeEnd` | `number` | Fim de intervalo: `S01E01-E03`, `S01E01E02`, `3x14-15`. Só quando maior que `episode`. |
| `resolution` | `480p`, `576p`, `720p`, `1080p`, `2160p` | `4K` e `UHD` viram `2160p`. `1920x1080` vira `1080p`. |
| `source` | `BluRay`, `WEB-DL`, `WEBRip`, `HDTV`, `HDRip`, `DVD`, `CAM` | |
| `codec` | `H.264`, `H.265`, `AV1`, `VP9`, `XviD`, `DivX` | `x264`/`AVC` viram `H.264`; `x265`/`HEVC` viram `H.265`. |
| `audio` | `dubbed`, `subtitled`, `dual` | `Dublado`, `Legendado`, `Dual Audio`, ou os dois juntos (`dual`). |
| `languageHints` | `string[]` | Só códigos explícitos: `PT-BR`, `PT BR`, `Nacional` (pt-BR), `Inglês`/`English` (en), `Japonês` (ja), `Espanhol` (es). |
| `group` | `string` | Grupo de fansub: primeiro colchete do início (`[Erai-raws] ...`), quando não é tag conhecida. |
| `isSpecial` | `true` | `Especial`, `OVA`, `Extras` (fora do título), ou temporada `0`. |

Campo ausente significa "não achado no texto". Nunca é palpite: o parser não infere idioma de "Dublado" nem
temporada de um número solto.

## Regras

1. **Limpeza:** links, `@menções`, `#hashtags` e emoji saem. A extensão (`.mkv`, `.mp4`...) sai. `.` e `_` viram espaço, exceto em `H.264`, `H.265` e canais de áudio (`5.1`).
2. **Linhas:** só a primeira linha com palavras forma o título. As seguintes (sinopse, legenda) só trazem tags.
3. **Fim do título:** a primeira tag (resolução, codec, fonte, áudio, idioma), temporada/episódio ou ano que vem depois de pelo menos uma palavra de título.
4. **Palavras comuns:** `Dual`, `CAM`, `Web`, `Extra`, `Special`, `Nacional`, `English` só são tag depois do título e quando a palavra seguinte é tag ou fim (`Dual Survival` continua título; `Movie CAM` tem `source: 'CAM'`).
5. **Ano:** entre parênteses, sempre. Solto, só conta se estiver depois de pelo menos uma palavra de título e seguido de tag ou fim. `2012` sozinho é título.
6. **`E05` solto:** só vale com título antes (`Show E05 1080p`) ou com `seriesTitle` informado. Sem isso, não é episódio.
7. **Anime:** `Título - 12` vira episódio 12 quando o número vem seguido de tag, de outro `-` ou do fim. `Título - Parte 2` não vira episódio.
8. **Colchetes:** tags dentro de colchetes contam como tags. `[S01E02]` continua sendo temporada/episódio. Outro conteúdo de colchete some do título.

## Limitações conhecidas

Pinadas em `MEDIA_NAME_KNOWN_LIMITS` (o teste falha se o comportamento mudar sem querer):

- `Blade Runner 2049 1080p` lê `2049` como ano. Com parênteses (`Blade Runner 2049 (2017)`) funciona.
- Ponto em sigla vira espaço: `E.T.` sai como `E T`.

Também não cobertos (ficam no título ou somem, sem erro):

- `Parte 1` / `Part 2` não são campo próprio: continuam no título.
- Codec de áudio (`DDP5.1`, `AAC`) é descartado. Não há campo para ele.

## Como acrescentar um caso

Adicione uma entrada a `MEDIA_NAME_CORPUS` com o nome inventado e o objeto completo esperado. Campo ausente no
`expect` significa "o parser não deve achar". Para um caso ambíguo que hoje erra, use `MEDIA_NAME_KNOWN_LIMITS` e
documente aqui. Nunca use nomes reais de canal no corpus.
