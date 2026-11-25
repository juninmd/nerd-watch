import { EMBED_ALLOW, EMBED_SANDBOX } from './watch-embed.ts';

/** Iframe de um item que toca por embed (YouTube/PeerTube), isolado por `sandbox` e com permissões mínimas. */
export function EmbedFrame({ url, title }: { url: string; title: string }) {
  return (
    <iframe
      src={url}
      title={title}
      sandbox={EMBED_SANDBOX}
      allow={EMBED_ALLOW}
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
    />
  );
}
