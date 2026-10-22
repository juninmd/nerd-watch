# ADR 0001 — Google Drive como fonte de vídeo

## Contexto
O app toca vídeos de canais do Telegram (fila, player global, "continuar assistindo", miniaturas em disco). O pedido
foi assistir também vídeos guardados em pastas do próprio Google Drive.

## Decisão
- **Pasta do Drive = canal de modo `drive`.** Reaproveita `telegram_channels`/`telegram_items`, rotas, fila, player e
  miniaturas. `handle` guarda o ID da pasta; `file_ref`, o ID do arquivo. A coluna `mode` ganhou `'drive'` por migração
  idempotente (`migrateAddDriveMode`). Renomear as tabelas para algo neutro fica como dívida consciente (migração
  maior, sem ganho funcional agora).
- **`messageId` sintético e numérico**: `createdTime(ms) * 1000 + hash3(fileId)`. O resto do app ordena e navega por
  `messageId` numérico crescente; o valor é estável para o mesmo arquivo entre sincronizações.
- **OAuth de app desktop com PKCE e redirect em loopback** (`http://127.0.0.1:<porta>/api/drive/oauth/callback`),
  escopo `drive.readonly`. O fluxo "dispositivo" do Google não aceita escopos do Drive.
- **Client ID/secret e refresh token em `.env` (0600)**, nunca no código ou no banco; o access token vive só em memória.
  O segredo nunca é exibido por HTTP.
- **Reprodução por proxy com `Range`** (`files/<id>?alt=media`): o token não sai do servidor.
- **Miniaturas** baixadas com token para o disco (host `googleusercontent.com` validado) e servidas localmente; link
  remoto que não virou arquivo é descartado (expira e exige token).

## Consequências
- Só toca o que o navegador toca (MP4/H.264, WebM). MKV/AVI não: o Drive não entrega o stream transcodificado pela API.
- Com a tela de consentimento em "Teste", o Google expira o refresh token em 7 dias; o app detecta `invalid_grant` e
  pede para reconectar (409). O guia na tela recomenda publicar o app ("Em produção").
- Só vídeos diretamente na pasta (sem subpastas), até 500 por sincronização.
- `DRIVE_FAKE_BASE_URL` (somente loopback) troca os endpoints do Google por um servidor falso em testes de ponta a ponta.
