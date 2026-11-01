# Internet Archive (coleção)

Qualquer coleção pública da Internet Archive vira um canal (`archive.org/details/<coleção>` ou o identificador). Sem conta, sem chave.

- Lista os 300 vídeos (`mediatype:movies`) mais recentes por data de publicação.
- Cada item toca pelo player embutido da Archive (`archive.org/embed/<id>`); `play` responde `501`.
- Miniatura de `archive.org/services/img/<id>`, seguindo no máximo um redirect dentro de `*.archive.org`.
- O identificador é restrito a `[A-Za-z0-9._-]` (entra na query), e só coleções (`mediatype: collection`) são aceitas.
- O catálogo "domínio público" continua restrito a `feature_films`; aqui o direito de uso do que cadastrar é seu.

Não verificado contra o serviço real nesta sessão (sem rede): coberto por testes com `fetch` falso.
