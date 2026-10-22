# YouTube (só embed)

Canais e playlists públicos do YouTube viram canais no nerd-watch. Não precisa de conta nem chave. Os vídeos tocam pelo embed oficial (`youtube-nocookie.com`).

## Como cadastrar

Em **Canais**, escolha "canal ou playlist do YouTube" e informe:

- link do canal: `https://www.youtube.com/channel/UC…`
- `@handle`, por exemplo `@YouTube`, ou o link `https://www.youtube.com/@handle`
- ID cru: `UC…` (canal) ou `PL…` (playlist)
- link de playlist: `https://www.youtube.com/playlist?list=PL…`

## Limites conhecidos

- **O feed público traz só os ~15 vídeos mais recentes** de cada canal ou playlist. Não há paginação sem a API com chave.
- O app não baixa, não faz proxy e não repassa vídeo do YouTube (os termos proíbem). `play` responde `501`. O item só é reproduzido pelo iframe.
- `@handle` precisa ler a página do canal. Se o YouTube mudar o HTML, o cadastro falha com mensagem clara, e o link `youtube.com/channel/UC…` continua funcionando.
- Sem duração (o feed não traz) e sem barra de progresso ou "continuar assistindo" (o iframe não expõe o tempo).
- A página do `@handle` é grande (~2 MB), por isso o limite de leitura é 4 MB.
- Na Europa o YouTube às vezes responde com página de consentimento. Isso não foi testado aqui, e o erro aparece como "formato inesperado".

## Verificado contra serviços reais

- Feed do canal `UCBR8-60-B28hp2BmDPdntcQ`: canal criado com 15 itens, todos com `embedUrl`, miniatura `image/jpeg`, `play` devolve `501`, embed responde `200`.
- Mesmo canal via `@YouTube`, resolvido pela página real, cai no mesmo canal.

## Não verificado

- Playlist real: o ID de teste que tentei devolveu `404`. O caminho `playlist_id` está coberto por teste com fetch falso e pela chamada ao feed, mas não por um ID público confirmado.
- Consentimento regional do YouTube.
