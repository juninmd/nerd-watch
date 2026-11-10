/**
 * Build do cliente para `public/`:
 *  - JS com code splitting (um chunk por tela, ver `src/client/app/routes.ts`) e CSS num arquivo só, minificados;
 *  - nomes com hash do conteúdo em `/assets/`, que o servidor entrega com cache imutável;
 *  - `.br` e `.gz` gerados aqui, uma vez, para o servidor não comprimir a cada requisição;
 *  - `index.html` reescrito com os nomes finais e `modulepreload` dos chunks que a entrada importa.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const OUT = 'public';
const started = performance.now();

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'assets'), { recursive: true });

const fail = (logs: unknown[]): never => {
  for (const log of logs) console.error(log);
  process.exit(1);
};

const app = await Bun.build({
  entrypoints: ['src/client/main.ts', 'src/client/styles.css'],
  outdir: OUT,
  naming: { entry: 'assets/[name]-[hash].[ext]', chunk: 'assets/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
  target: 'browser',
  splitting: true,
  minify: true,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!app.success) fail(app.logs);

// O service worker é um bundle à parte: precisa ficar na raiz (/sw.js) para ter escopo sobre o app inteiro.
const sw = await Bun.build({ entrypoints: ['src/client/pwa/sw.ts'], outdir: OUT, naming: 'sw.js', target: 'browser', minify: true });
if (!sw.success) fail(sw.logs);

const urlOf = (path: string): string => `/assets/${basename(path)}`;
const entry = app.outputs.find((o) => o.kind === 'entry-point' && o.path.endsWith('.js'));
const styles = app.outputs.find((o) => o.path.endsWith('.css'));
if (!entry || !styles) throw new Error('build sem o JS de entrada ou sem o CSS');

// Imports estáticos da entrada (`from"./chunk-x.js"`): o navegador os baixa em paralelo com ela, não em cascata.
const preloads = [...(await entry.text()).matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map((m) => `/assets/${m[1]}`);
const preloadTags = [...new Set(preloads)].map((href) => `<link rel="modulepreload" href="${href}" />`).join('\n    ');

const html = (await Bun.file('src/client/index.html').text())
  .replace('href="/styles.css"', `href="${urlOf(styles.path)}"`)
  .replace('src="/app.js"', `src="${urlOf(entry.path)}"`)
  .replace('<!-- preload -->', preloadTags);
if (!html.includes(urlOf(entry.path)) || !html.includes(urlOf(styles.path))) throw new Error('index.html sem os marcadores /app.js e /styles.css');
await Bun.write(join(OUT, 'index.html'), html);

await copyFile('src/client/pwa/manifest.webmanifest', join(OUT, 'manifest.webmanifest'));
await copyFile('src/client/pwa/icon.svg', join(OUT, 'icon.svg'));

// Pré-compressão: só texto que o navegador pede na carga (mapas de fonte ficam de fora, ninguém os baixa em uso normal).
const COMPRESSIBLE = /\.(js|css|html|svg|webmanifest)$/;
let raw = 0;
let brotli = 0;
const files = [...(await readdir(OUT)).map((f) => join(OUT, f)), ...(await readdir(join(OUT, 'assets'))).map((f) => join(OUT, 'assets', f))];
for (const file of files.filter((f) => COMPRESSIBLE.test(f))) {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } });
  await Bun.write(`${file}.br`, br);
  await Bun.write(`${file}.gz`, gzipSync(bytes, { level: 9 }));
  raw += bytes.byteLength;
  brotli += br.byteLength;
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} kB`;
const chunks = app.outputs.filter((o) => o.path.endsWith('.js')).length;
console.log(
  `client compilado em ${Math.round(performance.now() - started)} ms: ${chunks} chunks JS, entrada ${kb(entry.size)}, CSS ${kb(styles.size)}, total ${kb(raw)} (${kb(brotli)} em brotli)`,
);
