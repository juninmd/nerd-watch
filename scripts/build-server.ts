/**
 * Compila o servidor em um único executável (sidecar do Tauri) com `bun build --compile`.
 *
 * Por que existe: o instalador não pode carregar `node_modules` (166 MB, milhares de arquivos) nem
 * exigir Bun instalado na máquina de quem usa. O binário sai em `src-tauri/binaries/` com o
 * triplo do alvo, que é o nome que `bundle.externalBin` espera.
 *
 * O único ajuste de resolução é `node-datachannel` → stub: módulo nativo não entra em executável
 * único (ver src/server/torrent/webrtc-off.ts e docs/adr/0005-desktop-sidecar.md).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STUB = `${ROOT}src/server/torrent/webrtc-off.ts`;

/** Triplo do rustc (ex.: x86_64-pc-windows-msvc); é o sufixo que o Tauri exige no externalBin. */
const targetTriple = (): string => {
  const rustc = Bun.spawnSync(['rustc', '-vV'], { stdout: 'pipe', stderr: 'pipe' });
  const host = rustc.stdout
    .toString()
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length)
    .trim();
  if (host) return host;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return process.platform === 'win32' ? `${arch}-pc-windows-msvc` : `${arch}-unknown-linux-gnu`;
};

const triple = targetTriple();
const outdir = `${ROOT}src-tauri/binaries`;
const outfile = `${outdir}/nerd-watch-server-${triple}${process.platform === 'win32' ? '.exe' : ''}`;
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [`${ROOT}src/server/worker.ts`],
  target: 'bun',
  minify: true,
  plugins: [
    {
      name: 'node-datachannel-off',
      setup(build) {
        build.onResolve({ filter: /^node-datachannel$/ }, () => ({ path: STUB }));
      },
    },
  ],
  compile: { outfile },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`sidecar do servidor: ${outfile}`);
