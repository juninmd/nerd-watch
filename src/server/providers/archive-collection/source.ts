import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { ARCHIVE_ID, downloadThumb, fetchCollectionName, listCollection } from './api.ts';

const HOSTS = new Set(['archive.org', 'www.archive.org']);

/** Aceita o identificador cru ou `https://archive.org/details/<coleção>`. */
export const parseCollectionInput = (raw: string): string | null => {
  const text = raw.trim();
  if (ARCHIVE_ID.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    const id = /^\/details\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    return id && ARCHIVE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
};

const idOfHandle = (handle: string): string | null => {
  const id = handle.startsWith('archive:') ? handle.slice('archive:'.length) : '';
  return ARCHIVE_ID.test(id) ? id : null;
};

/** Coleção da Internet Archive como canal; cada item toca pelo player embutido da própria Archive (sem proxy). */
export const archiveCollectionSource: FileSource = {
  mode: 'archive',

  link(handle) {
    const id = idOfHandle(handle);
    return id ? `https://archive.org/details/${encodeURIComponent(id)}` : null;
  },

  async resolve(input) {
    const id = parseCollectionInput(input);
    if (!id) throw new SourceError('informe o link archive.org/details/<coleção> ou o identificador da coleção', 400);
    return { handle: `archive:${id}`, name: await fetchCollectionName(id) };
  },

  async list(handle) {
    const id = idOfHandle(handle);
    if (!id) throw new SourceError('coleção da Internet Archive inválida', 400);
    return listCollection(id);
  },

  play() {
    return Promise.reject(new SourceError('os itens da Internet Archive tocam pelo player embutido', 501));
  },

  embedUrl: (fileRef) => (ARCHIVE_ID.test(fileRef) ? `https://archive.org/embed/${encodeURIComponent(fileRef)}` : null),

  thumb: (item) => (item.fileRef ? downloadThumb(item.fileRef) : Promise.resolve(null)),
};

export const registerArchiveCollection = (): void => {
  registerSource(archiveCollectionSource);
  registerDescriptor({
    id: 'archive',
    title: 'Internet Archive (coleção)',
    description: 'Qualquer coleção pública da Internet Archive vira um canal, tocada pelo player embutido. Sem conta, sem chave.',
    icon: 'film',
    fields: [],
    add: {
      mode: 'archive',
      label: 'coleção da Internet Archive (link ou identificador)',
      placeholder: 'archive.org/details/prelinger ou prelinger',
      hint: 'Até 300 vídeos mais recentes da coleção. Você é responsável pelo direito de uso do que cadastrar.',
    },
    configured: () => true,
    connected: () => true,
  });
};
