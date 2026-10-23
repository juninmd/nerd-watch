# Avisos de lançamento

Um agendador no servidor olha os próximos episódios e estreias dos títulos da sua lista (a mesma base da Agenda) e
envia **um aviso por lançamento**, na primeira vez em que ele cai dentro da janela de antecedência. Não há conta, login
nem serviço próprio: você escolhe o destino no `.env`.

- **Destinos:** webhook genérico (`POST` JSON) e/ou [ntfy](https://ntfy.sh) (tópico, texto puro). Pode usar um, outro ou os dois.
- **Configuração:** só por variável de ambiente. Nenhuma rota HTTP aceita ou altera destino.
- **Antecedência:** `NOTIFY_LEAD_DAYS`, de `0` a `7`. Padrão `0`: avisa no dia do lançamento.
- **Ciclo:** o agendador roda ao subir o servidor e depois a cada 15 min.
- **Desligado por padrão:** sem `NOTIFY_WEBHOOK_URL` nem `NOTIFY_NTFY_URL` válidas, nada é agendado.

## Variáveis

| Variável | Valor | Efeito |
| --- | --- | --- |
| `NOTIFY_WEBHOOK_URL` | `http://` ou `https://` | ativa o sink de webhook |
| `NOTIFY_NTFY_URL` | `http://` ou `https://` (ex.: `https://ntfy.sh/seu-topico`) | ativa o sink ntfy |
| `NOTIFY_LEAD_DAYS` | inteiro de `0` a `7` | antecedência; valor inválido vira `0` |

A URL costuma carregar um segredo (token no caminho ou na query, ou o nome do tópico). Trate-a como senha: ela não
aparece em log nem em resposta HTTP.

## Formato do envio

**Webhook**: `POST` com `Content-Type: application/json`:

```json
{
  "event": "release",
  "kind": "episode",
  "title": "Nome do título",
  "date": "2026-10-22",
  "season": 2,
  "episode": 5,
  "daysUntil": 0,
  "text": "Nome do título: T2E5 sai hoje (2026-10-22)"
}
```

Para filme, `kind` é `movie` e `season`/`episode` são `null`.

**ntfy**: `POST` com o corpo em texto puro (`text`) e o header `Title: Lançamento: <título>`. Título fora do ASCII
vai codificado em RFC 2047 e é cortado em 60 caracteres.

O payload traz só título, datas e a frase do aviso. Nada de conta, e-mail ou identificador seu.

## Regras de entrega

- **Uma vez por lançamento.** A chave é título + episódio (ou filme) + data. O que já foi entregue fica na tabela
  `notifications_sent` do SQLite, então reiniciar o servidor não repete aviso. Mudar a data do lançamento gera um novo
  aviso; mudar `NOTIFY_LEAD_DAYS` não.
- **Timeout de 8 s por sink.** Um destino lento não atrasa o outro.
- **Sem seguir redirecionamento.** Um `3xx` é falha. Assim o token da URL nunca vai para outro host.
- **Marcado como enviado só se ao menos um sink aceitou.** Se todos falharem, o aviso volta no próximo ciclo.
- **Retry limitado.** Até 3 tentativas por aviso enquanto o processo estiver de pé. Depois disso, o aviso fica de fora
  até o próximo boot.
- **Logs sem segredo.** A linha de erro mostra o nome do sink e o host (ex.: `webhook (hooks.exemplo.com): HTTP 500`),
  nunca a URL completa.

## Limites conhecidos

- Se um sink falhar e o outro entregar, o aviso conta como enviado: o sink que falhou não recebe de novo.
- Na primeira subida, todo lançamento que já está dentro da janela é avisado de uma vez. Com `NOTIFY_LEAD_DAYS=7` e uma
  lista grande, isso pode ser um volume alto de uma só vez.
- O envio é de melhor esforço: não há fila persistente. Se o servidor estiver desligado no dia do aviso, o aviso daquele
  dia não sai (o próximo ciclo só cobre lançamentos ainda dentro da janela).
- Só http(s). Esquemas como `file:` ou `ftp:` são descartados ao ler a configuração.
