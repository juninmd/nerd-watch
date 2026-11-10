/**
 * Benchmark reprodutível: `bun run bench` (ou `bun run bench -- --titles 5000 --json saida.json`).
 *
 * Sobe o servidor real num banco temporário, popula por SQL e mede só por HTTP, então roda igual em qualquer
 * commit (é assim que o "antes e depois" dos PRs é gerado). Mede três coisas:
 *  1. casca do app: quantas requisições e quantos bytes trafegam até a primeira tela, a frio e na revisita;
 *  2. latência das rotas de leitura mais usadas (p50/p95) com uma biblioteca grande;
 *  3. latência de escrita (PATCH na biblioteca), que depende do fsync do SQLite.
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const TITLES = Number(arg('titles', '2000'));
const ROUNDS = Number(arg('rounds', '200'));
const JSON_OUT = arg('json', '');
const PORT = Number(arg('port', '7897'));
/** `--keep` deixa o banco temporário no disco (o caminho sai no fim) para investigar uma consulta à mão. */
const KEEP = process.argv.includes('--keep');
const BASE = `http://127.0.0.1:${PORT}`;

const dir = mkdtempSync(join(tmpdir(), 'nerd-watch-bench-'));
process.env.DB_PATH = join(dir, 'bench.db');
process.env.PORT = String(PORT);
process.env.TMDB_API_KEY = '';
process.env.TORRENT_ENABLED = 'false';

const quiet = console.log;
console.log = () => {};
const serverDef = (await import('../src/server/index.ts')).default as { fetch: (req: Request) => Response | Promise<Response> };
console.log = quiet;
const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: serverDef.fetch });
await fetch(`${BASE}/api/library`); // abre o banco e aplica o schema

// ---------- dados ----------
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString();
const seed = (): void => {
  const db = new Database(process.env.DB_PATH as string);
  const statuses = ['want', 'watching', 'watched', 'dropped'] as const;
  const genres = ['Drama', 'Comédia', 'Ficção científica', 'Suspense', 'Animação', 'Documentário'];
  const insTitle = db.query(
    `INSERT INTO titles (id, source, source_id, media_type, title, overview, poster_path, release_date, vote_average, created_at, genres, runtime_minutes)
     VALUES (?, 'tmdb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insSeason = db.query('INSERT INTO seasons (id, title_id, season_number, name, air_date) VALUES (?, ?, ?, ?, ?)');
  const insEpisode = db.query('INSERT INTO episodes (id, season_id, episode_number, name, overview, air_date, runtime) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insEntry = db.query(
    `INSERT INTO library_entries (id, title_id, watch_status, rating, current_season, current_episode, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insHistory = db.query('INSERT INTO library_history (id, title_id, kind, at, detail) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let i = 0; i < TITLES; i++) {
      const id = `bench-title-${i}`;
      const tv = i % 2 === 0;
      const status = statuses[(i >> 1) % 4] as string;
      insTitle.run(
        id,
        `bench-${i}`,
        tv ? 'tv' : 'movie',
        `Título de bancada ${i}`,
        'Sinopse fictícia usada só para dar um tamanho realista à resposta da biblioteca. '.repeat(3),
        `/poster-${i}.jpg`,
        day(((i * 7) % 500) - 440).slice(0, 10),
        (i % 100) / 10,
        day(-400),
        JSON.stringify([genres[i % genres.length], genres[(i + 2) % genres.length]]),
        tv ? 45 : 95 + (i % 40),
      );
      if (tv) {
        for (let s = 1; s <= 2; s++) {
          const seasonId = `${id}-s${s}`;
          insSeason.run(seasonId, id, s, `Temporada ${s}`, day(-300 + s * 30).slice(0, 10));
          for (let e = 1; e <= 10; e++) {
            // parte dos episódios cai nos próximos 60 dias (agenda); o resto é passado ou futuro distante
            const air = day(-200 + ((i * 13 + s * 37 + e * 7) % 700)).slice(0, 10);
            insEpisode.run(`${seasonId}-e${e}`, seasonId, e, `Episódio ${e}`, 'Resumo do episódio.', air, 45);
          }
        }
      }
      const at = day(-(i % 300));
      insEntry.run(`bench-entry-${i}`, id, status, status === 'watched' ? 5 + (i % 6) : null, tv ? 1 : null, tv ? 1 + (i % 9) : null, at, at);
      insHistory.run(`bench-h-${i}-a`, id, 'added', at, null);
      if (status === 'watched') insHistory.run(`bench-h-${i}-f`, id, 'finished', day(-(i % 300) + 0.01), null);
      if (tv) insHistory.run(`bench-h-${i}-p`, id, 'progress', day(-(i % 300) + 0.02), `T1 E${1 + (i % 9)}`);
    }
  })();
  db.close();
};
seed();

// ---------- medições ----------
interface Wire {
  requests: number;
  bytes: number;
}
const ENCODINGS = 'br, gzip';

/** Baixa um recurso sem descomprimir e devolve o que de fato trafegou (corpo) e o texto para achar dependências. */
const pull = async (path: string, headers: Record<string, string> = {}): Promise<{ status: number; bytes: number; text: string; res: Response }> => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Accept-Encoding': ENCODINGS, ...headers }, decompress: false } as RequestInit);
  const raw = new Uint8Array(await res.arrayBuffer());
  const enc = res.headers.get('Content-Encoding');
  let text = '';
  if (res.status === 200) {
    const plain = enc === 'br' ? brotliDecompressSync(raw) : enc === 'gzip' ? gunzipSync(raw) : raw;
    text = new TextDecoder().decode(plain);
  }
  return { status: res.status, bytes: raw.byteLength, text, res };
};

/** Segue o que o navegador baixa para pintar a tela inicial: HTML, CSS (com @import), JS de entrada e os chunks dela. */
const shell = async (revisit: Map<string, { etag: string | null; immutable: boolean }> | null): Promise<{ wire: Wire; seen: Map<string, { etag: string | null; immutable: boolean }> }> => {
  const wire: Wire = { requests: 0, bytes: 0 };
  const seen = new Map<string, { etag: string | null; immutable: boolean }>();
  const queue = ['/'];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    const prev = revisit?.get(path);
    if (prev?.immutable) {
      seen.set(path, prev); // cache do navegador: nem sai requisição
      continue;
    }
    const got = await pull(path, prev?.etag ? { 'If-None-Match': prev.etag } : {});
    wire.requests++;
    wire.bytes += got.bytes;
    seen.set(path, { etag: got.res.headers.get('ETag'), immutable: /immutable/.test(got.res.headers.get('Cache-Control') ?? '') });
    // revisita com 304: o corpo não veio, então as dependências são as mesmas da primeira visita
    if (got.status === 304 && revisit) for (const p of revisit.keys()) if (!seen.has(p)) queue.push(p);
    const dirOf = path.slice(0, path.lastIndexOf('/') + 1);
    const abs = (ref: string): string => new URL(ref, `${BASE}${dirOf}`).pathname;
    if (path === '/' || path.endsWith('.html')) {
      for (const m of got.text.matchAll(/<(?:link|script)[^>]+(?:href|src)="([^"]+\.(?:css|js))"/g)) queue.push(abs(m[1] as string));
    } else if (path.endsWith('.css')) {
      for (const m of got.text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) queue.push(abs(m[1] as string));
    } else if (path.endsWith('.js')) {
      // imports estáticos (baixados junto) e, com code splitting, o chunk da tela inicial que a entrada pede ao abrir
      for (const m of got.text.matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)) queue.push(abs(m[1] as string));
      for (const m of got.text.matchAll(/import\(["'](\.\/home-page-[^"']+\.js)["']\)/g)) queue.push(abs(m[1] as string));
    }
  }
  return { wire, seen };
};

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;

const latency = async (make: (i: number) => Request, rounds = ROUNDS): Promise<{ p50: number; p95: number; bytes: number }> => {
  for (let i = 0; i < 10; i++) await (await fetch(make(i))).arrayBuffer();
  const times: number[] = [];
  let bytes = 0;
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    const res = await fetch(make(i));
    bytes = (await res.arrayBuffer()).byteLength;
    times.push(performance.now() - t0);
    if (!res.ok) throw new Error(`${make(i).url} respondeu ${res.status}`);
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95), bytes };
};

const get = (path: string) => () => new Request(`${BASE}${path}`);
const year = new Date().getFullYear();

const cold = await shell(null);
const warm = await shell(cold.seen);
const results = {
  commit: (await Bun.$`git rev-parse --short HEAD`.text().catch(() => '?')).trim(),
  titles: TITLES,
  shell: { cold: cold.wire, revisit: warm.wire },
  read: {
    'GET /api/library': await latency(get('/api/library')),
    'GET /api/library?status=watching': await latency(get('/api/library?status=watching')),
    'GET /api/library/up-next': await latency(get('/api/library/up-next')),
    'GET /api/calendar': await latency(get('/api/calendar')),
    [`GET /api/stats?year=${year}`]: await latency(get(`/api/stats?year=${year}&tz=America/Sao_Paulo&hpd=1`)),
    'GET /api/health': await latency(get('/api/health')),
  },
  write: {
    'PATCH /api/library/:titleId': await latency(
      (i) =>
        new Request(`${BASE}/api/library/bench-title-${i % TITLES}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 1 + (i % 10) }),
        }),
    ),
  },
};

const ms = (n: number): string => `${n.toFixed(2)} ms`;
const kb = (n: number): string => `${(n / 1024).toFixed(1)} kB`;
console.log(`\nnerd-watch bench @ ${results.commit} (${TITLES} títulos, ${ROUNDS} rodadas por rota)\n`);
console.log(`casca, 1ª visita : ${results.shell.cold.requests} requisições, ${kb(results.shell.cold.bytes)} trafegados`);
console.log(`casca, revisita  : ${results.shell.revisit.requests} requisições, ${kb(results.shell.revisit.bytes)} trafegados\n`);
for (const [name, r] of Object.entries({ ...results.read, ...results.write })) {
  console.log(`${name.padEnd(36)} p50 ${ms(r.p50).padStart(10)}  p95 ${ms(r.p95).padStart(10)}  ${kb(r.bytes).padStart(10)}`);
}
if (JSON_OUT) await Bun.write(JSON_OUT, JSON.stringify(results, null, 2));

server.stop(true);
if (KEEP) console.log(`\nbanco mantido em ${process.env.DB_PATH}`);
else rmSync(dir, { recursive: true, force: true });
process.exit(0);
