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

await copyFile('src/client/index.html', 'public/index.html');
await copyFile('src/client/styles.css', 'public/styles.css');
for (const file of await readdir('src/client/styles')) {
  await copyFile(`src/client/styles/${file}`, `public/styles/${file}`);
}

console.log(`client compilado (${result.outputs.length} artefatos)`);
