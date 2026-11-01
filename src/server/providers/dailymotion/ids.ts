export type DailymotionRef = { kind: 'user'; id: string } | { kind: 'playlist'; id: string };

const USER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PLAYLIST_ID = /^x[a-z0-9]{3,10}$/;
export const VIDEO_ID = /^x[a-z0-9]{3,10}$/;
const DM_HOSTS = new Set(['dailymotion.com', 'www.dailymotion.com']);
/** Rotas do site que não são nome de usuário. */
const RESERVED = new Set(['video', 'playlist', 'embed', 'search', 'explore', 'library', 'upload', 'settings', 'legal', 'en', 'fr', 'pt']);

/** Link do canal/playlist, `playlist/x…`, ou o nome do canal (usuário) cru. Qualquer outra coisa é inválida. */
export const parseDailymotionInput = (raw: string): DailymotionRef | null => {
  const text = raw.trim();
  if (PLAYLIST_ID.test(text) && /\d/.test(text)) return { kind: 'playlist', id: text };
  if (USER.test(text) && !RESERVED.has(text.toLowerCase())) return { kind: 'user', id: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !DM_HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
  const playlist = /^\/playlist\/(x[a-z0-9]{3,10})(?:_[^/]*)?\/?$/.exec(url.pathname)?.[1];
  if (playlist) return { kind: 'playlist', id: playlist };
  const user = /^\/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\/?$/.exec(url.pathname)?.[1];
  return user && !RESERVED.has(user.toLowerCase()) ? { kind: 'user', id: user } : null;
};

/** Handle guardado no banco: `dailymotion:user:<nome>` ou `dailymotion:playlist:x…`. Revalidado a cada uso. */
export const parseDailymotionHandle = (handle: string): DailymotionRef | null => {
  const m = /^dailymotion:(user|playlist):([A-Za-z0-9_.-]{1,64})$/.exec(handle);
  if (!m) return null;
  const kind = m[1] as 'user' | 'playlist';
  const id = m[2] ?? '';
  return (kind === 'user' ? USER.test(id) : PLAYLIST_ID.test(id)) ? { kind, id } : null;
};

export const handleOfDailymotion = (ref: DailymotionRef): string => `dailymotion:${ref.kind}:${ref.id}`;

/** Embed com o ID validado; ID malformado nunca vira URL. */
export const dailymotionEmbedUrl = (videoId: string): string | null => (VIDEO_ID.test(videoId) ? `https://www.dailymotion.com/embed/video/${videoId}` : null);

export const dailymotionLink = (ref: DailymotionRef): string =>
  ref.kind === 'user' ? `https://www.dailymotion.com/${encodeURIComponent(ref.id)}` : `https://www.dailymotion.com/playlist/${ref.id}`;
