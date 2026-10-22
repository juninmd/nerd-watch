# Dropbox (fonte de vídeo)

Cada pasta do seu Dropbox vira um canal no nerd-watch. Os vídeos da pasta (só o nível de cima, sem subpastas) aparecem como itens, do mais novo ao mais antigo, até 500 por canal.

## Variáveis de ambiente

| Variável | Obrigatória | Conteúdo |
| --- | --- | --- |
| `DROPBOX_APP_KEY` | sim | App key do app (não é segredo). |
| `DROPBOX_REFRESH_TOKEN` | gerada pelo "Conectar" | Refresh token. É segredo: fica no `.env` (0600) e nunca volta para o navegador. |

O app é um cliente público: usa PKCE, sem client secret. Não existe `DROPBOX_APP_SECRET`.

## Cadastro do app (passo a passo)

1. Abra <https://www.dropbox.com/developers/apps> e clique em **Create app**.
2. Escolha a API com acesso com escopo (**Scoped access**) e **Full Dropbox**, para enxergar pastas fora de uma pasta própria do app.
3. Na aba **Permissions**, marque `files.metadata.read` e `files.content.read` e clique em **Submit**. A conexão só pede escopos marcados aqui.
4. Na aba **Settings**, em **OAuth 2 > Redirect URIs**, adicione exatamente a URL que aparece no guia da tela de Conexões (`http://localhost:<PORT>/api/sources/dropbox/oauth/callback`) e clique em **Add**. O Dropbox compara a URI caractere por caractere, porta incluída; por isso o `PORT` do app precisa ser o mesmo do cadastro.
5. Copie o **App key** (aba Settings) para o campo da tela de Conexões, salve e clique em **Conectar**.

Os nomes de abas e botões seguem a interface do console do Dropbox na data da escrita; se mudarem, o que não muda é o conteúdo: os dois escopos e a redirect URI exata.

## Escopos

- `files.metadata.read`: listar pastas (`files/list_folder`, `files/list_folder/continue`).
- `files.content.read`: link de reprodução (`files/get_temporary_link`) e miniaturas (`files/get_thumbnail_v2`).

Nada de escrita, de exclusão ou de compartilhamento.

## Como funciona

- **Adicionar canal**: informe o caminho da pasta, por exemplo `/Vídeos`. O caminho é validado (sem `.`, `..`, barra invertida, caracteres de controle); o canal guarda o caminho em minúsculas, já que o Dropbox não diferencia caixa.
- **Listagem**: paginada (`has_more` / `cursor`), no máximo 50 páginas por sincronização. Só arquivos com extensão de vídeo entram, e só IDs `id:…` no formato esperado.
- **Reprodução**: a cada play o servidor pede um link temporário e repassa o `Range` a ele. O link vale cerca de 4 horas (depois o Dropbox responde 410); por isso nunca é guardado no banco. O navegador nunca recebe o link nem o token.
- **Miniaturas**: `get_thumbnail_v2` em jpeg, 1024×768, com teto de 2 MB. Falha de miniatura não derruba a sincronização.
- **Desconectar**: revoga no Dropbox (o endpoint de revogação recebe um access token, então o servidor troca o refresh token por um novo antes de revogar) e apaga o refresh token local.

## Limites conhecidos

- Duração dos vídeos não é preenchida (o `media_info` não foi confirmado na documentação que consegui ler).
- Uma miniatura por vídeo por sincronização: pastas muito grandes geram muitas chamadas e podem bater no limite de taxa do Dropbox (resposta 429 vira "sem miniatura", não erro).
- Renomear a pasta no Dropbox muda o caminho; o canal aponta para o caminho original até ser recriado.
- Não há verificação com conta real neste repositório: a integração foi testada contra um fetch falso que segue o formato documentado.
