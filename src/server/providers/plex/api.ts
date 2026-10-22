import type { NewTelegramItem } from '../../repo/telegram.ts';
import { readSetting } from '../sources/settings.ts';
import {
  type Service,
  apiUrl,
  arrayOf,
  collectPages,
  durationSeconds,
  episodeCaption,
  getJson,
  getStream,
  getThumbBytes,
  safeRange,
  serverBase,
  serverPath,
} from '../sources/media-server.ts';
import { SourceError } from '../sources/types.ts';

export const PLEX: Service = { name: 'Plex', secretLabel: 'token' };
export const SECTION_PREFIX = 'plex:section:';
export const SHOW_PREFIX = 'plex:show:';
/** Identificação do cliente exigida pela API; constante porque o nerd-watch é uma instalação só. */
const CLIENT_ID = 'nerd-watch';
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const RATING_KEY_RE = /^\d{1,12}$/;
const NOT_CONFIGURED = 'Plex não configurado — informe endereço e token em Conexões';
const MAX_INPUT = 200;
/** Caminho da parte do arquivo que o próprio Plex devolve (`/library/parts/<id>/<versão>/<arquivo>`). */
const PART_KEY_RE = /^\/library\/parts\/\d+\/\d+\/[^?#\\]+$/;
const THUMB_PATH_RE = /^\/library\/metadata\/\d+\/thumb\/\d+$/;
/** Tipos do Plex na busca de seção: 1 = filme, 4 = episódio (a lista de uma série é de episódios). */
const LIBTYPE_BY_SECTION = new Map([
  ['movie', '1'],
  ['show', '4'],
]);

export interface PlexItem {
  ratingKey?: string;
  type?: string;
  title?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  /** Duração em milissegundos. */
  duration?: number;
  /** Data de inclusão no servidor, em segundos desde a época. */
  addedAt?: number;
  thumb?: string;
  Media?: Array<{ Part?: Array<{ key?: unknown }> }>;
}

interface PlexSection {
  key?: string;
  title?: string;
  type?: string;
}

interface PlexContainer<T> {
  MediaContainer?: { totalSize?: number; Metadata?: T[]; Directory?: T[] };
}

const config = (): { base: URL; token: string } => {
  const url = readSetting('PLEX_URL');
  const token = readSetting('PLEX_TOKEN');
  if (!url || !token) throw new SourceError(NOT_CONFIGURED, 501);
  if (!TOKEN_RE.test(token)) throw new SourceError('token do Plex com formato inválido — corrija em Conexões', 501);
  return { base: serverBase(url, PLEX), token };
};

/** Identificação e token no cabeçalho; nunca na URL. JSON só quando pedido (sem o `Accept`, o Plex devolve XML). */
const headers = (token: string, json: boolean): Record<string, string> => ({
  'X-Plex-Token': token,
  'X-Plex-Client-Identifier': CLIENT_ID,
  'X-Plex-Product': CLIENT_ID,
  ...(json ? { Accept: 'application/json' } : {}),
});

const sections = async (): Promise<PlexSection[]> => {
  const { base, token } = config();
  const body = await getJson<PlexContainer<PlexSection>>(PLEX, apiUrl(base, '/library/sections'), headers(token, true), 'o Plex não tem bibliotecas');
  return arrayOf<PlexSection>(body.MediaContainer?.Directory);
};

/** Seção de biblioteca (nome ou número) ou série (`show:<ratingKey>`). Só filmes e séries são aceitos. */
export const resolvePlexInput = async (input: string): Promise<{ handle: string; name: string }> => {
  if (input.length > MAX_INPUT) throw new SourceError('nome da biblioteca longo demais', 400);
  const show = /^show:(\d{1,12})$/i.exec(input.trim());
  if (show?.[1]) return resolveShow(show[1]);

  const wanted = input.trim().toLowerCase();
  const found = (await sections()).find((s) => s.key === wanted || s.title?.trim().toLowerCase() === wanted);
  if (!found?.key || !found.title || !RATING_KEY_RE.test(found.key)) throw new SourceError('biblioteca não encontrada no Plex (confira o nome ou o número)', 404);
  if (!found.type || !LIBTYPE_BY_SECTION.has(found.type)) throw new SourceError('só dá para usar bibliotecas de filmes e séries do Plex', 400);
  return { handle: `${SECTION_PREFIX}${found.key}`, name: found.title };
};

const resolveShow = async (ratingKey: string): Promise<{ handle: string; name: string }> => {
  const { base, token } = config();
  const body = await getJson<PlexContainer<PlexItem>>(PLEX, apiUrl(base, `/library/metadata/${ratingKey}`), headers(token, true), 'série não encontrada no Plex');
  const item = body.MediaContainer?.Metadata?.[0];
  if (item?.type !== 'show' || !item.title) throw new SourceError('o item informado não é uma série no Plex', 400);
  return { handle: `${SHOW_PREFIX}${ratingKey}`, name: item.title };
};

/** Página de metadados com paginação do próprio Plex (cabeçalhos `X-Plex-Container-*`). */
const pagedMetadata = (path: string, query: Record<string, string>): Promise<PlexItem[]> => {
  const { base, token } = config();
  return collectPages<PlexItem>(async (start, size) => {
    const pageHeaders = { ...headers(token, true), 'X-Plex-Container-Start': String(start), 'X-Plex-Container-Size': String(size) };
    const body = await getJson<PlexContainer<PlexItem>>(PLEX, apiUrl(base, path, query), pageHeaders, 'biblioteca não encontrada no Plex');
    const total = body.MediaContainer?.totalSize;
    return { items: arrayOf<PlexItem>(body.MediaContainer?.Metadata), total: typeof total === 'number' ? total : undefined };
  });
};

/** Itens do canal: seção (filmes ou episódios de séries) ou os episódios de uma série. */
export const listPlexHandle = async (handle: string): Promise<PlexItem[]> => {
  if (handle.startsWith(SHOW_PREFIX)) {
    const ratingKey = handle.slice(SHOW_PREFIX.length);
    if (!RATING_KEY_RE.test(ratingKey)) throw new SourceError('série inválida', 404);
    return pagedMetadata(`/library/metadata/${ratingKey}/allLeaves`, {});
  }
  if (handle.startsWith(SECTION_PREFIX)) {
    const key = handle.slice(SECTION_PREFIX.length);
    if (!RATING_KEY_RE.test(key)) throw new SourceError('biblioteca inválida', 404);
    const section = (await sections()).find((s) => s.key === key);
    const libtype = section?.type ? LIBTYPE_BY_SECTION.get(section.type) : undefined;
    if (!libtype) throw new SourceError('biblioteca não encontrada no Plex', 404);
    return pagedMetadata(`/library/sections/${key}/all`, { type: libtype, sort: 'addedAt:desc' });
  }
  throw new SourceError('canal inválido', 404);
};

/** Caminho do arquivo (`Media[0].Part[0].key`) do item. Só o caminho de parte é aceito, nunca outro destino. */
const partKeyOf = async (ratingKey: string): Promise<string> => {
  const { base, token } = config();
  const body = await getJson<PlexContainer<PlexItem>>(PLEX, apiUrl(base, `/library/metadata/${ratingKey}`), headers(token, true), 'vídeo não encontrado no Plex');
  const raw = body.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key;
  if (raw === undefined) throw new SourceError('vídeo sem arquivo no Plex', 404);
  const key = serverPath(raw, PART_KEY_RE);
  if (!key) throw new SourceError('o Plex devolveu um caminho de arquivo que não reconheço', 502);
  return key;
};

/** Arquivo original da parte, com `Range` repassado. Nada de transcodificação. */
export const streamPlexItem = async (ratingKey: string, range: string | undefined): Promise<Response> => {
  const { base, token } = config();
  const partKey = await partKeyOf(ratingKey);
  const rangeHeader = safeRange(range);
  return getStream(PLEX, apiUrl(base, partKey), rangeHeader ? { ...headers(token, false), Range: rangeHeader } : headers(token, false));
};

/** Capa pequena do item (poster do próprio item, caminho validado). Null em qualquer falha. */
export const plexThumb = async (thumbPath: string | null | undefined): Promise<Uint8Array | null> => {
  const path = serverPath(thumbPath, THUMB_PATH_RE);
  if (!path) return null;
  const { base, token } = config();
  return getThumbBytes(apiUrl(base, path), headers(token, false));
};

/** `addedAt` tem resolução de segundo: o hash de `syntheticMessageId` colidiria entre itens da mesma varredura. Aqui o ratingKey ocupa a parte baixa (únicos enquanto o ID for < 1e6). */
const plexMessageId = (addedAt: number | undefined, ratingKey: string): string => {
  const seconds = typeof addedAt === 'number' && Number.isFinite(addedAt) && addedAt > 0 ? Math.floor(addedAt) : 0;
  return String(seconds * 1_000_000 + (Number(ratingKey) % 1_000_000));
};

export const toItems = (items: PlexItem[]): NewTelegramItem[] =>
  items.flatMap((item) => {
    const ratingKey = typeof item.ratingKey === 'string' && RATING_KEY_RE.test(item.ratingKey) ? item.ratingKey : null;
    if (!ratingKey) return [];
    const addedAt = typeof item.addedAt === 'number' ? new Date(item.addedAt * 1000) : null;
    const postedAt = addedAt && !Number.isNaN(addedAt.getTime()) ? addedAt.toISOString() : null;
    const title = item.title ?? '';
    return [
      {
        messageId: plexMessageId(item.addedAt, ratingKey),
        caption: item.type === 'episode' ? episodeCaption(item.grandparentTitle, item.parentIndex, item.index, title) : title,
        durationSeconds: durationSeconds(item.duration, 1000),
        thumbnailUrl: serverPath(item.thumb, THUMB_PATH_RE),
        postedAt,
        fileRef: ratingKey,
      },
    ];
  });

export const plexConfigured = (): boolean => Boolean(readSetting('PLEX_URL') && readSetting('PLEX_TOKEN'));

export const validateToken = (value: string): string | null => (TOKEN_RE.test(value) ? null : 'token com formato inválido (só letras, números, _ e -)');
