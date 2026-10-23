# ADR 0002 — Conversão de MKV/AVI/MOV/TS/WMV/FLV/MPEG com ffmpeg opcional

## Contexto
O `<video>` do navegador só toca MP4/M4V/WebM de forma confiável. Arquivos de pasta local em MKV, AVI, MOV, TS, WMV,
FLV e MPEG aparecem na lista mas não tocam. O app não pode virar um transcodificador obrigatório: a instalação padrão
(Bun + binário único, sem dependências do sistema) precisa continuar funcionando sem ffmpeg.

## Decisão
1. **ffmpeg é opcional e detectado a cada chamada** (`FFMPEG_PATH`/`FFPROBE_PATH` ou PATH). Sem ele: nenhuma rota de
   conversão faz nada, a reprodução segue como antes, e a UI mostra o motivo e como ativar.
2. **Escolha do caminho mais barato, por sondagem (ffprobe JSON, com prazo e teto de saída):**
   - `direct`: contêiner MP4/M4V/WebM. Não sonda, não converte.
   - `remux`: vídeo H.264 8 bits 4:2:0 progressivo. Vídeo copiado (`-c:v copy`), áudio copiado se AAC/MP3/Opus ou
     convertido para AAC estéreo. Sai como MP4 com `faststart` no cache, servido com `Range`.
   - `transcode`: qualquer outra coisa (HEVC, 10 bits, MPEG-4, VP9, AV1, WMV, MPEG-2, entrelaçado). H.264 `yuv420p`,
     `veryfast`, CRF 23, teto de 4 Mb/s, altura máxima 1080, áudio AAC estéreo. Sai como MP4 fragmentado no stdout.
   - `unavailable`: sem trilha de vídeo. Motivo para a UI.
3. **Transcodificação em stream com `?start=S`, não HLS.** O navegador toca fMP4 progressivo sem biblioteca extra. HLS
   em Chrome/Firefox exigiria hls.js (MSE), uma dependência nova sem ganho proporcional para o caso de uso local. O
   cliente soma o offset à posição do elemento (ver `docs/transcoding.md`). Trade-off aceito: sem seek nativo no
   stream; cada seek fora do trecho baixado reabre o ffmpeg.
4. **Remux em arquivo, não em stream.** Copiar o vídeo é rápido e o MP4 em cache permite `Range` real, seek nativo e
   retomada sem offset.
5. **Entrada só por caminho local resolvido pelo servidor.** A função de localização reusa `locateVideo` (realpath
   dentro de uma raiz de `LOCAL_MEDIA_DIRS`). `-protocol_whitelist file`. Nenhum URL vira entrada do ffmpeg, então não
   há loopback HTTP, e o problema de o token de acesso aparecer em argumentos de processo não existe.
   **Consequência: fontes remotas (Drive, S3, WebDAV, Telegram, torrent) não são convertidas nesta versão.**
6. **Argumentos sempre por array, sem shell.** Os builders (`media/args.ts`) só aceitam número validado, enum fixo e
   caminho absoluto; o arquivo de saída é um nome gerado (hash) com sufixo `.part`. Há testes que injetam texto
   hostil em cada entrada.
7. **Concorrência:** `TRANSCODE_MAX_JOBS` slots (padrão 1). Sem slot livre, 503 com `Retry-After: 15`. Remux tem dedupe
   por chave (mesmo arquivo e mesma trilha = um processo). Cancelar a resposta (aba fechada) mata o ffmpeg. Ociosidade
   (`TRANSCODE_IDLE_SECONDS`) mata o processo. SIGTERM/SIGINT matam todos os filhos. Boot apaga `*.part` órfãos.
8. **Cache LRU por tamanho** (`TRANSCODE_CACHE_MAX_MB`, padrão 4096). Apaga o menos usado recentemente; nunca apaga o
   que está em uso.
9. **Legendas:** texto (SRT/ASS/mov_text) sai como WebVTT por `GET .../subtitles/:n`. Sem queimar no vídeo. Sem UI
   nesta versão (outra frente cuida da UI de legenda).

## Alternativas descartadas
- **HLS com hls.js:** nova dependência de runtime (CVE/licença/manutenção a checar), mais código de playlist e cache de
  segmentos, para um ganho que o stream fMP4 com `?start=` já entrega no caso local.
- **Transcodificar tudo para arquivo antes de tocar:** tempo até o primeiro frame igual ao tempo de conversão do
  arquivo inteiro (minutos para um filme em HEVC).
- **Servir o arquivo cru com `video/x-matroska`:** Chromium não toca MKV de forma confiável; o problema original.
- **Ffmpeg como entrada via HTTP loopback (`/api/...`):** exigiria passar o `ACCESS_TOKEN` para o processo; a
  alternativa de token assinado de curta duração não compensa quando a entrada local já existe.

## Consequências
- Imagem Docker maior: o pacote `ffmpeg` do Debian (com as bibliotecas de codec que ele puxa) soma centenas de MB. A
  imagem base `oven/bun` é Debian, então o pacote vem do repositório oficial assinado pelo apt. Medição real não feita
  aqui (o daemon Docker não estava rodando); ver `docs/transcoding.md`.
- CPU: transcodificação em tempo real de 1080p em `veryfast` ocupa vários núcleos. Por isso o padrão é 1 job.
- Limites conhecidos: HDR (tone mapping não feito, cores podem sair lavadas), fontes remotas não convertidas, legenda
  bitmap (PGS/VobSub) não extraída, seek no stream transcodificado depende de reabrir o processo.
- Testes de integração geram arquivos sintéticos (lavfi) em diretório temporário e pulam com mensagem se o ffmpeg faltar.
