# PeerTube

Canais de instâncias PeerTube públicas viram canais no nerd-watch. Não precisa de conta, chave nem variável de ambiente.

## Como cadastrar

Em **Canais**, escolha o modo "canal do PeerTube" e informe uma destas formas:

- `canal@instancia.tld`, por exemplo `blender_open_movies@video.blender.org`
- `https://instancia.tld/c/canal` ou `https://instancia.tld/video-channels/canal`

O app consulta `GET /api/v1/video-channels/<canal>` na instância e usa o `displayName` como nome do canal.

## Como toca

- **Arquivo direto (MP4/WebM):** o servidor faz proxy com `Range` a partir do arquivo da própria instância, com a maior resolução até 1080p. O arquivo nunca passa pela memória inteira.
- **Só HLS:** quando a instância não tem arquivo direto, a rota de reprodução responde `409` com `embedUrl`. O player troca para um iframe com o embed oficial da instância, e o item segue na fila. Sem arquivo direto não há posição salva nem barra de progresso.

## Limites conhecidos

- Só `https:` em instâncias públicas. Porta explícita, IP literal, `localhost`, nomes locais (`.local`, `.lan`, `.internal` e outros) e credenciais embutidas são recusados antes de qualquer requisição.
- A validação é sintática. Um nome DNS público que resolva para endereço privado não é bloqueado, porque isso exigiria fixar o IP da resolução. Esse risco está registrado no PR.
- Até 500 vídeos por canal, em páginas de 100, do mais novo ao mais antigo.
- Arquivos só do mesmo host da instância (CDN ou object storage em outro domínio cai no embed).
- Redirecionamento do arquivo não é seguido (vira erro 502 nosso).
- Miniaturas: só o caminho `/lazy-static/thumbnails/…` no mesmo host, até 2 MB.

## Verificado contra serviços reais

- `blender_open_movies@video.blender.org`: canal criado com 23 vídeos, miniatura `image/jpeg`, `curl -r 0-99` devolve `206` com `Content-Range: bytes 0-99/34860812`.
- `joinpeertube@framatube.org`: instância só com HLS. O play devolve `409` com `embedUrl`, e o embed responde `200`.

## Não verificado

- Instâncias com storage em CDN de outro host (caem no embed, não testadas).
- Contagem de `count` acima de 100 (o app pede 100; a documentação oficial não foi lida por completo).
