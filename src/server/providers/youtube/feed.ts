import { VIDEO_ID } from './ids.ts';

export interface FeedVideo {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

export interface Feed {
  title: string | null;
  videos: FeedVideo[];
}

const MAX_ENTRIES = 50;
const MAX_TITLE = 300;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodifica só as entidades XML padrão, numa passada (`&amp;lt;` vira `&lt;`, nunca `<`). */
const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });

const textOf = (raw: string | undefined): string => {
  if (raw === undefined) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return (cdata ? (cdata[1] ?? '') : decode(raw)).trim().slice(0, MAX_TITLE);
};

const firstTag = (block: string, tag: string): string | undefined => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1];

/**
 * Feed Atom do YouTube lido com regex, sem parser XML completo: não há DTD, entidades externas nem árvore para
 * estourar. Um documento com DOCTYPE/ENTITY é recusado de cara; entrada que não é um `<feed>` devolve null.
 */
export const parseFeed = (xml: string): Feed | null => {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<feed[\s>]/.test(xml)) return null;
  const firstEntry = xml.search(/<entry[\s>]/);
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const title = textOf(firstTag(head, 'title')) || null;

  const videos: FeedVideo[] = [];
  const entries = xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g);
  for (const entry of entries) {
    if (videos.length >= MAX_ENTRIES) break;
    const block = entry[1] ?? '';
    const videoId = firstTag(block, 'yt:videoId')?.trim() ?? '';
    if (!VIDEO_ID.test(videoId)) continue;
    const published = firstTag(block, 'published')?.trim() ?? '';
    videos.push({ videoId, title: textOf(firstTag(block, 'title')) || 'Vídeo sem título', publishedAt: Number.isFinite(Date.parse(published)) ? published : null });
  }
  return { title, videos };
};
