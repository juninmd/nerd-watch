export type YoutubeRef = { kind: 'channel'; id: string } | { kind: 'playlist'; id: string } | { kind: 'handle'; handle: string };

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^(?:PL|UU|FL|LL|OLAK5uy_)[A-Za-z0-9_-]{8,60}$/;
const HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/** Link do canal/playlist, `@handle`, ou o ID cru (`UC…` ou `PL…`). Qualquer outra coisa é inválida. */
export const parseYoutubeInput = (raw: string): YoutubeRef | null => {
  const text = raw.trim();
  if (CHANNEL_ID.test(text)) return { kind: 'channel', id: text };
  if (PLAYLIST_ID.test(text)) return { kind: 'playlist', id: text };
  if (HANDLE.test(text)) return { kind: 'handle', handle: text };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !YT_HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
  const list = url.searchParams.get('list');
  if (list && PLAYLIST_ID.test(list)) return { kind: 'playlist', id: list };
  const channel = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(url.pathname)?.[1];
  if (channel) return { kind: 'channel', id: channel };
  const handle = /^\/(@[A-Za-z0-9._-]{3,30})\/?$/.exec(url.pathname)?.[1];
  return handle ? { kind: 'handle', handle } : null;
};

/** Handle guardado no banco: `youtube:channel:UC…` ou `youtube:playlist:PL…`. Revalidado a cada uso. */
export const parseYoutubeHandle = (handle: string): { kind: 'channel' | 'playlist'; id: string } | null => {
  const m = /^youtube:(channel|playlist):([A-Za-z0-9_-]{10,64})$/.exec(handle);
  if (!m) return null;
  const kind = m[1] as 'channel' | 'playlist';
  const id = m[2] ?? '';
  const valid = kind === 'channel' ? CHANNEL_ID.test(id) : PLAYLIST_ID.test(id);
  return valid ? { kind, id } : null;
};

export const handleOfYoutube = (kind: 'channel' | 'playlist', id: string): string => `youtube:${kind}:${id}`;

/** Embed sem cookies (youtube-nocookie) com o ID validado; ID malformado nunca vira URL. */
export const youtubeEmbedUrl = (videoId: string): string | null =>
  VIDEO_ID.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0` : null;

export const youtubeLink = (kind: 'channel' | 'playlist', id: string): string =>
  kind === 'channel' ? `https://www.youtube.com/channel/${id}` : `https://www.youtube.com/playlist?list=${id}`;
