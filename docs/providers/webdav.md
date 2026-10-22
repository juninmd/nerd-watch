# WebDAV (`webdav`)

Pastas de um servidor WebDAV (Nextcloud, ownCloud, NAS com WebDAV) viram canais. O navegador nunca fala com o servidor: o nerd-watch faz a listagem e o proxy do vídeo, e o usuário e a senha ficam só no servidor.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `WEBDAV_URL` | sim | Endereço base do WebDAV, `http(s)`, **sem** usuário/senha e sem `?`/`#`. Ex.: `https://nas.local/remote.php/dav/files/ana` (Nextcloud). |
| `WEBDAV_USER` | sim | Usuário. Não pode conter `:`. |
| `WEBDAV_PASSWORD` | sim | Senha ou senha de aplicativo (segredo: nunca volta para o navegador). |

## Autenticação

Somente **HTTP Basic**. **Digest não é suportado.** Em servidores que exigem Digest, a fonte responde 409 (credencial recusada).

Use HTTPS sempre que possível. Em LAN, `http://` é aceito, porque é o uso normal de um NAS.

## Como adicionar

1. Em Conexões, preencha endereço, usuário e senha e salve.
2. Em "Adicionar canal", informe o caminho da pasta **na raiz do servidor** (começando com `/`), por exemplo `/Videos/Anime`.

## Como funciona

- **Listagem:** `PROPFIND` com `Depth: 1` na pasta do canal e em até **2 níveis de subpastas**. Ordenado por `getlastmodified` (mais novo primeiro), teto de 500 itens.
- **Reprodução:** `GET` autenticado com o `Range` repassado. A resposta é 206/200 com `Accept-Ranges`, e o corpo é transmitido sem ser carregado na memória.
- **Miniatura:** nenhuma. WebDAV não tem miniatura padrão.

## Segurança

- O servidor é quem envia os hrefs. Qualquer href que aponte para outra origem, para fora da pasta pedida, ou que tenha `..`, é descartado.
- **Redirect não é seguido.** Um 3xx resulta em 502 com a mensagem "ajuste WEBDAV_URL para o endereço final". Assim o `Authorization` nunca vai para outra origem.
- O XML de resposta tem limite de 5 MB. DOCTYPE e declarações de entidade são recusados. Há teto de profundidade (40) e de nós (50 mil).
- Erros são mensagens nossas. O corpo do servidor nunca é repassado.

## Limites conhecidos

- Subpastas além do nível 2 não são listadas.
- No máximo 40 requisições `PROPFIND` por listagem.
- `WEBDAV_URL` com caminho base (Nextcloud) é obrigatório. A raiz do servidor não é a URL base do usuário.
- Verificado apenas com servidor **falso** (testes com `fetch` injetado). Não houve teste com Nextcloud ou outro servidor real.
