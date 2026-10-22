import { isEmbedUrl } from './watch-embed.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Erro do `<video>`: a rota de reprodução diz se o vídeo só toca pelo embed (409 com `embedUrl`, HLS-only no
 * PeerTube) ou por que falhou. Range mínimo: sem isso, um erro dispararia o download completo só para ler o corpo.
 */
export const onPlayError = (src: string, handlers: { onEmbed(url: string): void; onMessage(text: string): void }, fetchFn: Fetcher = fetch): void => {
  const fallback = 'não foi possível reproduzir esse vídeo';
  fetchFn(src, { headers: { Range: 'bytes=0-0' } })
    .then((r) => r.json())
    .then((body: { embedUrl?: unknown; error?: unknown }) => {
      if (isEmbedUrl(body.embedUrl)) return handlers.onEmbed(body.embedUrl);
      handlers.onMessage(typeof body.error === 'string' ? body.error : fallback);
    })
    .catch(() => handlers.onMessage(fallback));
};
