import type { Database } from 'bun:sqlite';
import { telegramPersonalEnabled } from './config.ts';
import { getSource } from './providers/sources/registry.ts';
import { fetchPersonalThumbs } from './providers/telegram/personal-info.ts';
import { type TelegramChannel, listTelegramItems, setTelegramItemThumbnail } from './repo/telegram.ts';
import { downloadPhoto, readThumb, saveThumb, thumbUrl } from './telegram-photos.ts';
import type { TelegramItemRow } from './types.ts';

const CONCURRENCY = 4;
const isLocal = (url: string | null): boolean => url?.startsWith('/api/') ?? false;

const inBatches = async <T>(list: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> => {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(fn));
};

/** O item ainda precisa de miniatura local? (a URL é do CDN, não existe, ou o arquivo sumiu do disco) */
export const needsThumb = (item: Pick<TelegramItemRow, 'thumbnail_url'>): boolean => !isLocal(item.thumbnail_url);

/**
 * Traz as miniaturas dos vídeos para o disco e aponta `thumbnail_url` para a rota local: o navegador deixa de
 * depender do CDN (cujos links expiram) e o modo conta pessoal, que não tinha nenhuma, passa a ter. Nunca lança —
 * o que falhar fica como estava e é tentado de novo na próxima sincronização.
 */
export const localizeThumbs = async (db: Database, channel: TelegramChannel, items: TelegramItemRow[]): Promise<number> => {
  const pending = items.filter(needsThumb);
  if (pending.length === 0) return 0;
  let done = 0;
  const store = async (item: TelegramItemRow, bytes: Uint8Array | null | undefined) => {
    if (bytes && (await saveThumb(channel.id, item.message_id, bytes))) {
      setTelegramItemThumbnail(db, channel.id, item.message_id, thumbUrl(channel.id, item.message_id));
      done++;
    }
  };

  try {
    // Arquivo já em disco (ex.: banco restaurado): só reaponta, sem baixar de novo.
    const missing: TelegramItemRow[] = [];
    for (const item of pending) {
      if (await readThumb(channel.id, item.message_id)) {
        setTelegramItemThumbnail(db, channel.id, item.message_id, thumbUrl(channel.id, item.message_id));
        done++;
      } else missing.push(item);
    }

    if (channel.mode === 'personal' && telegramPersonalEnabled()) {
      const thumbs = await fetchPersonalThumbs(channel.handle, missing.map((i) => i.message_id));
      for (const item of missing) await store(item, thumbs.get(item.message_id));
    } else if (getSource(channel.mode)) {
      // Fontes de arquivo (Drive, WebDAV…): cada uma sabe baixar a própria miniatura (token, host permitido).
      const thumb = getSource(channel.mode)?.thumb;
      if (thumb) await inBatches(missing, CONCURRENCY, async (item) => store(item, await thumb({ handle: channel.handle, fileRef: item.file_ref, thumbnailUrl: item.thumbnail_url }).catch(() => null)));
    } else {
      await inBatches(missing, CONCURRENCY, async (item) => store(item, item.thumbnail_url ? await downloadPhoto(item.thumbnail_url).catch(() => null) : null));
    }
  } catch {
    // enriquecimento: a falha não pode derrubar a importação do canal
  }
  return done;
};

/** `waitMs`: quanto a abertura de um canal espera pelas miniaturas; o que passar disso termina em segundo plano. */
export const thumbLimits = { waitMs: 8_000 };
/** Depois de tentar, não tenta de novo antes disso: vídeo sem miniatura no Telegram não pode martelar a conta a cada abertura. */
const RETRY_AFTER_MS = 60_000;
const lastTry = new Map<string, number>();

export const resetThumbRetries = (): void => lastTry.clear();

/**
 * Ao abrir um canal: se algum vídeo ainda está sem miniatura local (importado antes da correção, ou o download
 * falhou), baixa agora e devolve a lista atualizada; sem nada faltando devolve a própria lista. Nunca lança.
 */
export const ensureThumbs = async (db: Database, channel: TelegramChannel, items: TelegramItemRow[]): Promise<TelegramItemRow[]> => {
  if (!items.some(needsThumb)) return items;
  const last = lastTry.get(channel.id);
  if (last !== undefined && Date.now() - last < RETRY_AFTER_MS) return items;
  lastTry.set(channel.id, Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, thumbLimits.waitMs);
  });
  try {
    await Promise.race([localizeThumbs(db, channel, items), budget]);
  } finally {
    clearTimeout(timer);
  }
  return listTelegramItems(db, channel.id);
};
