import { config, openSubtitlesEnabled } from '../config.ts';

/**
 * REST API oficial da OpenSubtitles.com (a antiga API XML-RPC de opensubtitles.org foi
 * desligada em 2026). Exige `Api-Key` própria, gratuita e auto-servida em
 * https://www.opensubtitles.com/pt/consumers — não existe caminho sem chave para busca.
 * Sem conta de usuário (só a Api-Key da aplicação) o download tem limite de 5/dia.
 */
const BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'nerd-watch v0.1.0';

export class OpenSubtitlesNotConfiguredError extends Error {
  constructor() {
    super('OPENSUBTITLES_API_KEY não configurada — adicione ao .env para buscar legendas.');
    this.name = 'OpenSubtitlesNotConfiguredError';
  }
}

export class OpenSubtitlesRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenSubtitlesRequestError';
  }
}

const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  if (!config.opensubtitles.apiKey) throw new OpenSubtitlesNotConfiguredError();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Api-Key': config.opensubtitles.apiKey,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new OpenSubtitlesRequestError(res.status, `OpenSubtitles respondeu ${res.status}`);
  return (await res.json()) as T;
};

interface OsSubtitleFile {
  file_id: number;
  file_name: string;
}

interface OsSubtitleAttributes {
  language: string;
  release: string;
  download_count: number;
  subtitle_id: string;
  files: OsSubtitleFile[];
}

interface OsSearchResponse {
  data: Array<{ id: string; attributes: OsSubtitleAttributes }>;
}

export interface SubtitleResult {
  subtitleId: string;
  language: string;
  release: string;
  downloadCount: number;
  fileId: number;
  fileName: string;
}

export const searchSubtitles = async (opts: { query?: string; tmdbId?: number; languages?: string }): Promise<SubtitleResult[]> => {
  const params = new URLSearchParams();
  if (opts.tmdbId) params.set('tmdb_id', String(opts.tmdbId));
  if (opts.query) params.set('query', opts.query);
  params.set('languages', opts.languages ?? config.opensubtitles.languages);

  const data = await call<OsSearchResponse>(`/subtitles?${params}`);
  return data.data
    .map((item) => {
      const file = item.attributes.files[0];
      if (!file) return null;
      return {
        subtitleId: item.attributes.subtitle_id,
        language: item.attributes.language,
        release: item.attributes.release,
        downloadCount: item.attributes.download_count,
        fileId: file.file_id,
        fileName: file.file_name,
      };
    })
    .filter((r): r is SubtitleResult => r !== null);
};

interface OsDownloadResponse {
  link: string;
  remaining: number;
}

export const requestSubtitleDownload = async (fileId: number): Promise<{ url: string; remaining: number }> => {
  const data = await call<OsDownloadResponse>('/download', { method: 'POST', body: JSON.stringify({ file_id: fileId }) });
  return { url: data.link, remaining: data.remaining };
};

export { openSubtitlesEnabled };
