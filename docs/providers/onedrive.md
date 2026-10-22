# OneDrive (fonte de vídeo, Microsoft Graph)

Cada pasta do seu OneDrive pessoal vira um canal no nerd-watch. Os vídeos da pasta (só o nível de cima) aparecem como itens, do mais novo ao mais antigo, até 500 por canal.

Somente contas Microsoft pessoais (`consumers`). Contas de trabalho ou escola não são suportadas por este provider.

## Variáveis de ambiente

| Variável | Obrigatória | Conteúdo |
| --- | --- | --- |
| `ONEDRIVE_CLIENT_ID` | sim | Application (client) ID do app registrado (não é segredo). |
| `ONEDRIVE_REFRESH_TOKEN` | gerada pelo "Conectar" | Refresh token. É segredo: fica no `.env` (0600) e nunca volta para o navegador. |

O app é público: usa PKCE, sem client secret. Não existe `ONEDRIVE_CLIENT_SECRET`.

## Cadastro do app (passo a passo)

1. Abra <https://entra.microsoft.com> e vá em **Applications > App registrations > New registration**.
2. Em **Supported account types**, escolha **Personal Microsoft accounts only**. Isso combina com o endpoint `consumers` usado pelo app.
3. Em **Redirect URI**, escolha a plataforma **Mobile and desktop applications** e adicione a URL do guia da tela de Conexões (`http://localhost:<PORT>/api/sources/onedrive/oauth/callback`).
4. Em **API permissions > Add a permission > Microsoft Graph > Delegated permissions**, marque **Files.Read**. O `offline_access` é pedido pelo próprio app para receber o refresh token.
5. Na página **Overview**, copie o **Application (client) ID** para o campo da tela de Conexões, salve e clique em **Conectar**.

Nomes de menus e telas seguem o Entra admin center na data da escrita. Se o Entra reclamar que o cliente não é público, procure a opção de permitir fluxos de cliente público (Authentication) e habilite-a; essa parte não foi confirmada na documentação que consegui ler.

## Escopos

- `Files.Read`: listar pastas e ler metadados e links de download do próprio usuário.
- `offline_access`: refresh token.

## Como funciona

- **Redirect**: para `localhost`, o Microsoft ignora a porta, mas o caminho precisa bater com o cadastrado. Por isso o app usa `localhost` (e não `127.0.0.1`), que é o host aceito para `http`.
- **Adicionar canal**: informe o caminho da pasta, por exemplo `/Vídeos`, ou `/` para a raiz. Cada segmento é codificado para a URL do Graph; `.`, `..`, `?`, `#`, `%`, `:` e barra invertida são recusados.
- **Listagem**: `GET …/children` com `$top=200` e `@odata.nextLink`, no máximo 50 páginas por sincronização. O `nextLink` só é seguido se a origem continuar sendo `https://graph.microsoft.com`; caso contrário o servidor para com erro, e o token nunca sai para outra origem.
- **Reprodução**: a cada play o servidor pede o item (`@microsoft.graph.downloadUrl`, pré-autenticado e de curta duração) e repassa o `Range` a esse link **sem** `Authorization`. Nada de link expirável é guardado no banco.
- **Miniaturas**: `thumbnails/0/medium/content` responde 302 para uma URL pré-autenticada; o servidor a segue sem `Authorization`. Teto de 2 MB.
- **Refresh token rotativo**: a cada renovação o Microsoft devolve um refresh token novo, que substitui o antigo. O cliente OAuth grava o novo.
- **Desconectar**: só apaga o refresh token local. Não há endpoint de revogação documentado que eu tenha confirmado para refresh token do Microsoft identity platform, então nada é revogado no lado do Microsoft.

## Limites conhecidos

- Só o nível de cima da pasta (sem recursão) e só arquivos de vídeo pela extensão ou pelo `file.mimeType`.
- Uma miniatura por vídeo por sincronização; falha vira "sem miniatura".
- Não há verificação com conta real neste repositório: a integração foi testada contra um fetch falso que segue a documentação oficial.
