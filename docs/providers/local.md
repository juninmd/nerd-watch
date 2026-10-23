# Pasta local (`local`)

Pastas do computador onde o nerd-watch roda viram canais; cada vídeo dentro delas vira um item.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `LOCAL_MEDIA_DIRS` | sim | Lista de **raízes** separada por `path.delimiter` (`;` no Windows, `:` no Linux/macOS). Vazia = fonte desligada. |

A lista de raízes é a **lista de permissão**. A UI só adiciona pastas que ficam dentro de uma delas. Um caminho fora das raízes é recusado, mesmo que exista no disco. Isso vale porque qualquer aba do navegador consegue fazer `POST` no servidor local (a proteção contra CSRF bloqueia origens externas, mas não as abas locais).

Exemplo (Windows):

```
LOCAL_MEDIA_DIRS=C:\Videos;D:\Series
```

## Como adicionar

Defina `LOCAL_MEDIA_DIRS` no `.env` e reinicie o app (a tela de Conexões só mostra o valor; a UI não altera essa lista). Depois, em "Adicionar canal", informe:

- um **caminho absoluto** dentro de uma raiz (`C:\Videos\Anime`), ou
- um **caminho relativo à primeira raiz** (`Anime`).

## Como funciona

- **Listagem:** vídeos (`mp4, m4v, mkv, webm, mov, avi, ogv, ts, wmv`) até 3 níveis de profundidade (filhos diretos da pasta do canal e dois níveis de subpastas). Ordenados por data de modificação, do mais novo para o mais antigo. Teto de 500 itens e de 20 000 entradas lidas.
- **Reprodução:** o servidor lê o arquivo do disco em stream e atende `Range` (`bytes=a-b`, `bytes=a-`, `bytes=-n`) com 206 e `Content-Range`. Faixa fora do arquivo, múltiplas faixas ou formato inválido resultam em 416.
- **Miniatura:** sem ffmpeg. Usa um arquivo ao lado do vídeo com o mesmo nome (`Ep 01.jpg`, `.jpeg` ou `.png`), ou `poster.jpg|png`, `folder.jpg|png` da mesma pasta. Sem sidecar, não há miniatura.

- **Formatos fora de MP4/M4V/WebM:** com ffmpeg disponível, o arquivo é copiado para MP4 (remux) ou transcodificado
  para H.264 em stream. Sem ffmpeg, o item aparece mas não toca, e a tela diz por quê. Ver [transcoding.md](../transcoding.md).

## Segurança

- Symlinks e junctions dentro de uma pasta **não são seguidos** na listagem.
- Cada requisição de reprodução refaz a checagem: o caminho real (`realpath`) precisa continuar dentro de uma raiz. Um atalho criado depois do cadastro é recusado.
- `fileRef` é validado: sem `..`, sem caminho absoluto, sem `:` (drive), sem barra invertida, só extensão de vídeo.
- Erros são mensagens nossas. Caminho e conteúdo do disco não aparecem na resposta.

## Limites conhecidos

- No Windows, a checagem de raiz ignora maiúsculas e minúsculas. Em Linux/macOS a comparação é exata.
- Um caminho relativo em `add` é resolvido pela **primeira raiz que existe** no disco.
- `LOCAL_MEDIA_DIRS` é **somente-leitura pela API/UI** (a rota de configuração responde 403): qualquer página aberta em outra porta de loopback passa pela checagem de `Origin` do app, e esta lista é a permissão de leitura do disco. Só quem edita o `.env` a amplia.
- Não há detecção de mudanças em tempo real: novos arquivos aparecem no próximo "atualizar".
