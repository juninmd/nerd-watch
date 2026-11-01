# Dailymotion (só embed)

Canais e playlists públicos do Dailymotion viram canais. Sem conta, sem chave (API pública `api.dailymotion.com`). Os vídeos tocam pelo embed oficial.

- Cadastro: nome do canal, `https://www.dailymotion.com/canal` ou `https://www.dailymotion.com/playlist/x…`.
- Até 300 vídeos mais recentes por canal (páginas de 100, no máximo 5).
- `play` responde `501`: o app não faz proxy do vídeo. Sem barra de progresso/"continuar assistindo" (o iframe não expõe o tempo).
- Miniaturas só do CDN `*.dmcdn.net`; ids e nomes são revalidados a cada uso.

Não verificado contra o serviço real nesta sessão (sem rede): coberto por testes com `fetch` falso.
