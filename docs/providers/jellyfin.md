# Jellyfin / Emby

Bibliotecas de um servidor Jellyfin viram canais no nerd-watch. A mesma API serve o Emby, mas **só o Jellyfin foi conferido contra a documentação**; o Emby não foi testado.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `JELLYFIN_URL` | sim | Endereço do servidor, ex.: `http://192.168.0.10:8096`. Pode ser IP da LAN e pode ter caminho (proxy em `/jellyfin`). Sem usuário e senha no endereço. |
| `JELLYFIN_API_KEY` | sim (segredo) | Chave de API. Gravada no `.env` pela tela de Conexões; nunca volta ao navegador. |

## Cadastro

1. No painel do Jellyfin, abra **Painel > Chaves de API** e crie uma chave para o nerd-watch.
2. Em Conexões, cole o endereço do servidor e a chave.
3. Em **Adicionar**, informe o nome da biblioteca (ex.: `Séries`) ou o ID dela.

> A chave de API dá acesso total ao servidor, como um administrador. Trate como senha.

## Como funciona

- **Autenticação:** cabeçalho `Authorization: MediaBrowser Token="<chave>"`. A chave nunca vai na URL (`api_key=`). Relatos da comunidade indicam que o Jellyfin 12 desligou o esquema legado (`X-Emby-Token`, `?api_key=`); por isso o cabeçalho oficial.
- **Lista:** `GET /Items` com `ParentId` (a biblioteca), `Recursive=true`, `IncludeItemTypes=Movie,Episode,Video`, ordenado por `DateCreated` decrescente. Até 500 itens, em páginas de 200 (`StartIndex`/`Limit`).
- **Título:** episódio vira `Série SxxEyy — Nome`; filme e vídeo usam o nome.
- **Duração:** `RunTimeTicks` (100 ns) convertido para segundos.
- **Reprodução:** `GET /Videos/{id}/stream?static=true` (arquivo original, sem transcodificação), com `Range` repassado pelo servidor do nerd-watch.
- **Miniatura:** `GET /Items/{id}/Images/Primary?maxHeight=480`, baixada no servidor, com teto de 2 MB.
- **Biblioteca por nome:** comparada sem diferença de maiúsculas com `GET /Library/VirtualFolders`. Coleções (BoxSet) não aparecem nessa lista; use o ID delas.

## Limites conhecidos

- **Sem transcodificação.** O navegador toca o arquivo original. Container ou codec que o navegador não reproduz (ex.: MKV com HEVC, na maioria dos navegadores) não toca. Não há HLS nem remux.
- **Sem `userId`.** A listagem não envia usuário. A documentação do Jellyfin 12.2 não marca `userId` como obrigatório em `/Items`, mas **não foi verificado num servidor real**. Se o servidor recusar a chamada sem usuário, o erro aparece como 502 ou 409 e é o primeiro ponto a checar.
- **Teto de 500 itens** por biblioteca, do mais novo ao mais antigo.
- **Sem link de origem:** `link` é nulo; o servidor é privado.

## Verificação feita

- Contrato dos endpoints conferido no OpenAPI oficial do Jellyfin, versão `12.2.0` (`https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json`): esquema `CustomAuthentication` (`apiKey` no cabeçalho `Authorization`), `/Items`, `/Library/VirtualFolders`, `/Videos/{itemId}/stream` (`static`), `/Items/{itemId}/Images/{imageType}`, enums `BaseItemKind` e `ItemSortBy`.
- Formato do cabeçalho `MediaBrowser Token="…"` conferido no SDK oficial TypeScript (`jellyfin/jellyfin-sdk-typescript`).
- Testes com `fetch` falso (`tests/jellyfin-source.test.ts`): não há chamada de rede nos testes.
- **Não houve verificação contra um servidor Jellyfin real.**
