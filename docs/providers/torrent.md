# Provider: torrent

Magnet link ou URL `.torrent` que **você cola** vira um canal; os vídeos do torrent viram os itens,
tocados em streaming pelo player do app.

> **Aviso de uso:** adicione só conteúdo que você tem direito de assistir. O app não busca, não indexa
> e não traz lista de sites ou trackers: ele só aceita o que você informa.

## Como usar

1. Em **Conexões → Torrent**, cole um `magnet:?xt=urn:btih:…` (40 hex ou 32 base32) **ou** uma URL
   `https://…/arquivo.torrent`.
2. O canal é criado e os vídeos aparecem em ordem natural de nome (`Ep 2` antes de `Ep 10`).

Regras de entrada:

- `.torrent` só por `https:`. `http:` é recusado: o `.torrent` define o infohash e os trackers, e por
  `http` um intermediário na rede pode trocar o arquivo sem ninguém notar.
- Redirecionamento só para a **mesma origem**. Um `archive.org/download/…` responde `302` para um
  `*.archive.org` de outro host; nesse caso cole o **link final** (o que o navegador baixa).
- Host local ou privado (`localhost`, `127.x`, `10.x`, `192.168.x`, `172.16–31.x`, IPv6 local) é recusado
  no `.torrent` e descartado dos trackers.
- Tamanho máximo do `.torrent`: 5 MB. Timeout: 15 s por requisição.
- Magnets: até 4096 caracteres; um só infohash; `x.pe` (IPs de peers), `ws` e parâmetros desconhecidos
  são descartados.
- Vídeos: extensões de vídeo conhecidas (`mp4`, `m4v`, `mkv`, `webm`, `mov`, `avi`, `ogv`, `ts`, `wmv`).
  Arquivos com `sample` (pasta ou palavra no nome) saem. Teto de 500 itens por torrent.

## Variáveis de ambiente

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `TORRENT_ENABLED` | ligado | `false` desliga o provider e o engine (501 nas rotas). |
| `TORRENT_PATH` | `.cache/torrents` | Pasta dos pedaços, relativa ao diretório de execução. |
| `TORRENT_MAX_CONNECTIONS` | 55 | Conexões de peers por torrent. |
| `TORRENT_UPLOAD_LIMIT_KB` | 100 | Teto de upload em KB/s (`-1` = sem limite). `0` é ignorado. |
| `TORRENT_MAX_ACTIVE` | 3 | Torrents abertos ao mesmo tempo (LRU). |
| `TORRENT_IDLE_MINUTES` | 10 | Sem leitura por esse tempo, o torrent é fechado e o disco liberado. |
| `TORRENT_METADATA_TIMEOUT_SECONDS` | 45 | Espera pela metadata antes de desistir. |

Não há senha ou chave: o provider é sem credenciais.

## Onde ficam os arquivos

Os pedaços baixados ficam em `TORRENT_PATH` (padrão `.cache/torrents`, relativo à pasta de onde o app
roda). O torrent é apagado do disco quando fica ocioso (`TORRENT_IDLE_MINUTES`) ou quando é fechado.
A origem de cada torrent (magnet) fica no banco, na tabela `torrent_sources`, para reabrir após um
reinício.

## Limitações conhecidas

- **Sem peers = sem vídeo.** Torrent depende de quem está semeando. Se nenhum peer entregar pedaços, o
  player espera e, depois de um tempo, a leitura fica sem bytes.
- **Web seeds são ignoradas.** Torrents da Internet Archive trazem `url-list` (HTTP direto no CDN).
  O provider genérico descarta isso de propósito (o servidor não busca URLs escolhidas pelo publicador).
  Consequência: itens com pouca semeadura podem não tocar aqui, mesmo sendo públicos. A reprodução do
  acervo da Archive pelo caminho próprio dela continua usando esses hosts.
- **Após reinício, a metadata vem dos peers.** Na primeira importação o `.torrent` já traz a metadata;
  depois de reiniciar o app o torrent é reaberto pelo magnet e precisa que algum peer entregue a
  metadata (até `TORRENT_METADATA_TIMEOUT_SECONDS`).
- **Container pode não tocar no navegador.** Só `mp4`, `m4v` e `webm` costumam tocar. `mkv`, `mov`,
  `ogv`, `avi` e HEVC são servidos com o tipo certo, mas o navegador pode não reproduzi-los.
- **Sem teto de disco por torrent.** O único limite é o tempo ocioso e o número de torrents abertos. Um
  pacote grande pode ocupar espaço enquanto estiver aberto.
- **Upload limitado.** O app não é seedbox: `TORRENT_UPLOAD_LIMIT_KB` limita o envio.
- **Nome de DNS que resolve para IP privado não é bloqueado.** A checagem de host local vale para IP
  literal e `localhost`, não para o DNS.
- **Trackers e infohash são confiados como estão.** O provider não verifica se o conteúdo é o que o
  título sugere.
- **Caminhos hostis recusam o torrent inteiro.** Um torrent com `..`, caminho absoluto ou unidade do
  Windows é recusado antes de qualquer escrita em disco.
