import { mkdir, copyFile, readdir } from 'node:fs/promises';

await mkdir('public/styles', { recursive: true });

const result = await Bun.build({
  entrypoints: ['src/client/main.ts'],
  outdir: 'public',
  naming: '[dir]/app.[ext]',
  target: 'browser',
  minify: true,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// O service worker é um bundle à parte: precisa ficar na raiz (/sw.js) para ter escopo sobre o app inteiro.
const sw = await Bun.build({
  entrypoints: ['src/client/pwa/sw.ts'],
  outdir: 'public',
  naming: 'sw.js',
  target: 'browser',
  minify: true,
});

if (!sw.success) {
  for (const log of sw.logs) console.error(log);
  process.exit(1);
}

await copyFile('src/client/index.html', 'public/index.html');
await copyFile('src/client/styles.css', 'public/styles.css');
await copyFile('src/client/pwa/manifest.webmanifest', 'public/manifest.webmanifest');
await copyFile('src/client/pwa/icon.svg', 'public/icon.svg');
for (const file of await readdir('src/client/styles')) {
  await copyFile(`src/client/styles/${file}`, `public/styles/${file}`);
}

console.log(`client compilado (${result.outputs.length} artefatos)`);
