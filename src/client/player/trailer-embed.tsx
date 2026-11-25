import { EMBED_ALLOW, EMBED_SANDBOX } from './watch-embed.ts';

const KEY_RE = /^[A-Za-z0-9_-]{6,32}$/;

/** URL do embed do trailer; null para chave ausente ou fora do formato de id do YouTube (a chave vem de terceiro). */
const trailerSrc = (key: string | null | undefined): string | null =>
  key && KEY_RE.test(key) ? `https://www.youtube.com/embed/${key}` : null;

/** Iframe do trailer. `id="trailer"` e `tabIndex={-1}`: o botão "Trailer" das telas rola e foca aqui. */
export function TrailerFrame({ trailerKey }: { trailerKey: string | null | undefined }) {
  const src = trailerSrc(trailerKey);
  if (!src) return null;
  return (
    <div className="trailer-frame" id="trailer" tabIndex={-1}>
      <iframe
        src={src}
        allowFullScreen
        title="trailer"
        sandbox={EMBED_SANDBOX}
        allow={EMBED_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
