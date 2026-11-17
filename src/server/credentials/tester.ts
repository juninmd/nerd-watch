
export interface TestResult {
  ok: boolean;
  message: string;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/** Injetável nos testes; em produção é o fetch global. */
let doFetch: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
export const setTesterFetchForTests = (f: Fetcher | null): void => {
  doFetch = f ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }));
};

const byStatus = (res: Response, okMessage: string): TestResult => {
  if (res.ok) return { ok: true, message: okMessage };
  if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, message: 'o serviço recusou a credencial' };
  return { ok: false, message: `o serviço respondeu ${res.status}` };
};

/**
 * Testa o valor JÁ SALVO (não aceita valor no corpo) contra o serviço, só com chamadas de leitura e sem efeito
 * colateral. A mensagem é fixa: nunca ecoa corpo de resposta nem a credencial.
 */
export const testCredential = async (key: string, value: string): Promise<TestResult> => {
  try {
    switch (key) {
      case 'TMDB_API_KEY': {
        const bearer = value.startsWith('eyJ');
        const url = new URL('https://api.themoviedb.org/3/configuration');
        if (!bearer) url.searchParams.set('api_key', value);
        return byStatus(await doFetch(url.toString(), { headers: bearer ? { Authorization: `Bearer ${value}` } : {} }), 'TMDB respondeu: chave válida');
      }
      case 'OPENSUBTITLES_API_KEY':
        return byStatus(
          await doFetch('https://api.opensubtitles.com/api/v1/infos/formats', { headers: { 'Api-Key': value, 'User-Agent': 'nerd-watch' } }),
          'OpenSubtitles respondeu: chave válida',
        );
      case 'TELEGRAM_BOT_TOKEN':
      case 'NOTIFY_TELEGRAM_BOT_TOKEN':
        // O token vai no caminho da URL: por isso `redirect: 'error'` e nenhuma mensagem de erro do fetch é repassada.
        return byStatus(await doFetch(`https://api.telegram.org/bot${value}/getMe`), 'Telegram respondeu: token válido');
      case 'NOTIFY_DISCORD_WEBHOOK_URL': {
        // GET no webhook só lê os metadados; não posta mensagem. Só hosts do Discord: o teste não pode virar um GET
        // do servidor para um endereço qualquer (SSRF).
        const host = new URL(value).hostname;
        if (host !== 'discord.com' && host !== 'discordapp.com' && !host.endsWith('.discord.com')) return { ok: false, message: 'só webhooks do discord.com podem ser testados' };
        return byStatus(await doFetch(value), 'Discord respondeu: webhook válido');
      }
      default:
        return { ok: false, message: 'sem teste disponível para esta credencial' };
    }
  } catch {
    return { ok: false, message: 'não foi possível falar com o serviço' };
  }
};

