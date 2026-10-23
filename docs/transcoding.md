# Conversão de formatos (MKV, AVI, MOV, TS, WMV, FLV, MPEG)

O navegador toca MP4/M4V/WebM. Para os outros formatos de pasta local, o app pode converter com **ffmpeg**. O ffmpeg é
opcional: sem ele, o app funciona como antes e a UI diz por que o arquivo não toca.

Decisões e trade-offs: [ADR 0002](adr/0002-conversao-com-ffmpeg.md).

## Ativar

1. Instale o ffmpeg com o ffprobe (o pacote inclui os dois).
   - Windows: `winget install Gyan.FFmpeg` (ou baixe o build e aponte as variáveis abaixo).
   - macOS: `brew install ffmpeg`. Linux: `apt install ffmpeg`.
2. Deixe no PATH, ou aponte no `.env`:
   ```
   FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
   FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
   ```
3. Reinicie o app. O log de boot mostra `conversão com ffmpeg` quando ele foi achado.

Docker: a imagem já instala o ffmpeg (ver "Imagem" abaixo).

## Variáveis

| Variável | Padrão | Descrição |
|---|---|---|
| `TRANSCODE_ENABLED` | `auto` | `auto`/`true` usam o ffmpeg se existir; `false` desliga a conversão mesmo com o binário presente. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | (PATH) | Caminho explícito. Se apontar para arquivo inexistente, a conversão fica desligada (não cai no PATH em silêncio). |
| `TRANSCODE_MAX_JOBS` | `1` | Processos de conversão ao mesmo tempo (1 a 8). Acima disso a requisição recebe 503 com `Retry-After`. |
| `TRANSCODE_CACHE_DIR` | `data/media-cache` | Onde ficam os MP4 convertidos (remux). Apagável a qualquer hora. |
| `TRANSCODE_CACHE_MAX_MB` | `4096` | Teto do cache. Passou, apaga o menos usado recentemente (LRU). |
| `TRANSCODE_IDLE_SECONDS` | `60` | Sem leitura do cliente (aba pausada, rede caiu) por esse tempo, o ffmpeg é morto. |
| `TRANSCODE_AUDIO_LANGS` | `por,pt,eng,en` | Idiomas preferidos da trilha de áudio, na ordem. Sem idioma conhecido, usa a trilha padrão do arquivo. |

Valores inválidos voltam ao padrão (nunca viram zero ou NaN que desligue um teto).

## O que acontece com cada arquivo

O servidor sonda o arquivo com `ffprobe` (com prazo e teto de saída) e escolhe o caminho mais barato:

| Arquivo | Caminho | O que o ffmpeg faz | Custo |
|---|---|---|---|
| `.mp4`, `.m4v`, `.webm` | **direto** | nada | zero |
| H.264 8 bits 4:2:0 progressivo, áudio AAC/MP3/Opus (MKV, AVI, MOV, TS) | **remux** | copia o vídeo, copia o áudio, grava MP4 `faststart` no cache | leitura e escrita do arquivo, sem perda |
| H.264 com áudio AC-3/DTS/FLAC/Vorbis | **remux** | copia o vídeo, converte o áudio para AAC estéreo | leve |
| HEVC, 10 bits, MPEG-4, VP9, AV1, WMV, MPEG-2, FLV | **transcodificado** | H.264 `yuv420p`, `veryfast`, CRF 23, máx. 4 Mb/s, altura máx. 1080, AAC | CPU alta, em tempo real |
| H.264 entrelaçado (tt/bb/tb/bt) | **transcodificado** | igual ao acima, com desentrelaçamento (`yadif`) | CPU alta |
| Só áudio (sem trilha de vídeo) | indisponível | — | o motivo aparece na UI |

Na prática:

- **Remux** prepara um MP4 no cache antes de tocar. A barra "Preparando… N%" mostra o progresso. Depois, o vídeo toca
  com `Range` (seek nativo, retomada, sem offset).
- **Transcodificado** toca na hora, em stream. O seek fora do trecho já baixado reabre o stream em outro ponto (`?start=`).
  A barra de progresso mostra o vídeo inteiro: o cliente soma o offset ao tempo do navegador (ver abaixo).

O selo no canto do vídeo mostra o caminho usado: `direto`, `remux`, `transcodificado` ou `indisponível`.

## Rotas (`/api/media/:canal/:item/…`)

Todas passam pela guarda de acesso do app (cookie de sessão ou `Authorization: Bearer` quando `ACCESS_TOKEN` está ligado).

| Método | Rota | Resposta |
|---|---|---|
| GET | `plan` | `{ path, reason?, audio?, deinterlace?, durationSeconds, audioOrdinal, audioTracks[], subtitleTracks[] }`. Sem caminhos do disco. |
| POST | `prepare?audio=N` | Remux: `{state, progress}` (202 em andamento, 200 pronto). 503 se não há slot. 409 se não é remux. |
| GET | `status?audio=N` | `{state: idle\|running\|ready\|error, progress, error?}` |
| GET | `file?audio=N` | MP4 do cache, com `Range` (206). 409 se ainda não está pronto. |
| GET | `live?audio=N&start=S` | Stream fMP4 transcodificado a partir de S segundos. `Accept-Ranges: none`. 503 sem slot. |
| GET | `subtitles/:n` | Trilha de texto `n` como WebVTT (até 2 MB). Bitmap (PGS/VobSub) não converte. |

Erros são mensagens nossas. Caminho do disco e saída do ffmpeg nunca aparecem na resposta.

## Garantias de segurança

- **Sem shell.** O ffmpeg e o ffprobe são chamados com array de argumentos (`Bun.spawn`).
- **Sem entrada do usuário nas flags.** `audio`, `start` e o índice de legenda viram número validado (ou erro). O caminho
  de entrada é o realpath já validado dentro de `LOCAL_MEDIA_DIRS`, e aparece só logo após `-i`.
- **`-protocol_whitelist file`.** O ffmpeg não abre URL, `concat:`, `subfile:` nem `http:`.
- **Saída só no cache, com nome gerado** (hash de caminho, tamanho e mtime; sufixo `.part` até terminar).
- **Morte garantida.** Cancelar a resposta, ociosidade, prazo de ffprobe, SIGTERM e SIGINT matam o processo (SIGTERM e,
  depois de 3 s, SIGKILL). Não há processo órfão depois do shutdown.
- **stderr limitado e nunca logado** (pode conter caminho).
- **Só fontes locais.** Drive, S3, WebDAV, Telegram e torrent não são convertidos nesta versão. Não há requisição HTTP
  saindo para o ffmpeg, então o `ACCESS_TOKEN` nunca vai para a linha de comando.

## Seek no stream transcodificado (cliente)

O stream `?start=S` começa em 0 para o navegador, mas representa S segundos do vídeo. O módulo
`src/client/media-shim.ts` faz o `<video>` daquele item falar a linha do vídeo inteiro:

- leitura de `currentTime` = `S + tempo nativo`; `duration` = duração do arquivo (do ffprobe);
- escrita de `currentTime`: se o alvo está no trecho que o navegador já tem, só move o ponteiro; senão reabre o
  stream com `?start=<alvo>`;
- com outro `src` (arquivo comum), tudo volta ao comportamento nativo. O resto do player não muda.

Retomada da posição salva usa o mesmo caminho (o stream começa direto em `resumeAt`).

## Limites conhecidos

- **HDR não é convertido com tone mapping**: o vídeo sai em `yuv420p` e as cores podem ficar lavadas.
- **Legenda bitmap** (PGS, VobSub) não é extraída. Legendas de texto saem pelo endpoint, sem UI nesta versão.
- **Arquivos com trilha de vídeo e áudio em codecs muito raros** podem falhar no ffmpeg; o erro vira mensagem genérica.
- **Seek no stream transcodificado** reabre o processo: há um pequeno atraso ao pular para fora do trecho baixado.
- **Transcodificação ao vivo ocupa CPU** (vários núcleos em 1080p). Com `TRANSCODE_MAX_JOBS=1`, um segundo vídeo
  convertido espera ou recebe 503 até o primeiro parar.
- **Cache de remux** guarda uma cópia do arquivo: um filme de 2 GB ocupa ~2 GB até o LRU apagar.
- **Busy no stream**: quando o stream transcodificado recebe 503, o navegador só reporta erro de reprodução; a
  mensagem de "ocupado" aparece apenas no caminho de remux.

## Imagem Docker

O `Dockerfile` instala `ffmpeg` com `apt-get install --no-install-recommends` (repositório Debian, assinado pelo apt).
O impacto no tamanho da imagem é o do pacote e suas bibliotecas de codec; medir com `docker images` depois do build
(não medido neste repositório até agora). O container continua como usuário `app` (não-root), e o cache vive em
`/app/data/media-cache`, dentro do volume de dados.

## Testes

- Puros: `tests/media-plan.test.ts` (tabela de decisão), `media-probe-parse.test.ts`, `media-args.test.ts` (argumentos
  e entradas hostis), `media-cache-settings.test.ts` (LRU, cache, ambiente), `media-client-seek.test.ts` (offset).
- Processos reais (sem ffmpeg): `media-process.test.ts` (slots, zumbis, prazo, contrapressão, ociosidade).
- Integração com ffmpeg: `media-ffmpeg.test.ts` gera MKV/AVI/HEVC/legenda sintéticos de 2 s, pula com mensagem se o
  ffmpeg não estiver no PATH, e verifica remux com `Range`, dedupe, `?start=`, cancelamento sem órfão, 503 com
  `Retry-After`, WebVTT e ffmpeg ausente.
