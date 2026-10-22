# Progresso de reprodução no servidor

"Continuar assistindo" deixou de viver só no `localStorage` do navegador. Agora o progresso também fica no SQLite
(`playback_positions`), sobrevive a limpar dados do navegador, troca de navegador ou outro aparelho na rede, e entra
no backup.

## O que sincroniza

- Posição (`seconds`, `duration`), `at`, marca `done` e `meta` (título, canal, rota de retorno) de cada vídeo.
- Chave = a mesma do cliente (`<canal>:<mensagem>` ou `archive:<id>`).

## O que não sincroniza

- Preferências do player (ordem da fila, autoplay): continuam só no navegador.
- Histórico: só a última posição de cada vídeo existe.

## Como funciona

- Local-first: a leitura continua síncrona no cache `nw.playback`. Nenhuma tela espera a rede.
- Envio: uma gravação por vídeo no máximo a cada ~12 s, mais envio imediato no pause/fim e envio com `keepalive` ao
  sair da página.
- Puxada: ao abrir o app e ao voltar para a aba. Funde por `at` (vence a gravação mais nova).
- Remoção de outro aparelho é respeitada; remoção local não ressuscita a partir do servidor.
- Primeira sincronização sobe o progresso que já existia no navegador (migração).
- Falha de rede: a fila fica no navegador e tenta de novo em ~60 s. Recusa permanente do servidor (400/413) descarta
  só aquele registro.

## API

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/playback?limit=&offset=` | lista, mais recentes primeiro (limite máx. 500) |
| PUT | `/api/playback/:key` | grava; ignora se o `at` for mais antigo que o guardado (`applied: false`) |
| DELETE | `/api/playback/:key` | remove |

Backup: `GET /api/backup` inclui `playbackPositions`. `POST /api/backup/import` aceita o campo opcional; backups antigos
sem ele continuam importando. Uma linha inválida recusa o backup inteiro antes de gravar qualquer coisa.

## Limites

- Chave: `[A-Za-z0-9_:.-]`, até 200 caracteres, sem `..`.
- `seconds` e `duration` entre 0 e 1.000.000. `at` não mais que 1 dia no futuro.
- `meta` até 2 KB (título e subtítulo 200 caracteres, miniatura 1000, rota interna até 300).
- Corpo de PUT até 8 KB.
- Tabela com teto de 5.000 linhas; passou disso, descartam-se as mais antigas.
- Cache local guarda as 200 posições mais recentes. Mais de 200 gravações sem rede podem perder as mais antigas.
- Sem autenticação além da barreira de Origin do app (servidor só em loopback).
