import { app } from './app.ts';
import { startBackgroundJobs } from './bootstrap.ts';

/**
 * Modo worker do app desktop: o shell Tauri embute o cliente (`frontendDist`) e fala com este
 * processo por JSON por linha no stdin/stdout — não existe página servida por HTTP.
 *
 * A porta de loopback que sobra serve **só bytes**: `<video>`/`<img>` e requisições `Range` não
 * cabem no protocolo de IPC do Tauri (resposta bufferizada), e torrent/legenda/transcodificação
 * dependem de streaming. O cliente nunca navega para ela; recebe a base no `ready`.
 *
 * Protocolo (uma linha JSON por mensagem):
 *   → {"id":1,"method":"GET","path":"/api/library","headers":{},"body":null}
 *   ← {"id":1,"status":200,"headers":{...},"body":"<base64>"}
 *   ← {"type":"ready","mediaBase":"http://127.0.0.1:PORT"} (primeira linha)
 */

// stdout é o canal do protocolo: log do app vai para stderr (o shell redireciona para .cache/desktop.log).
console.log = (...args: unknown[]) => console.error(...args);

const decode = (raw: string | null | undefined): Uint8Array | null => (raw ? Buffer.from(raw, 'base64') : null);
const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
/** `Blob` exige `ArrayBuffer` "puro"; o buffer do `Uint8Array` é `ArrayBufferLike` nas tipos do TS. */
const asBlob = (bytes: Uint8Array): Blob => new Blob([bytes as unknown as BlobPart]);

const handle = async (line: string): Promise<void> => {
  let id = 0;
  try {
    const message = JSON.parse(line) as {
      id: number;
      method: string;
      path: string;
      headers?: Record<string, string>;
      body?: string | null;
    };
    id = message.id;
    const headers = new Headers();
    for (const [key, value] of Object.entries(message.headers ?? {})) {
      // Host/Origin do webview não valem aqui: a requisição é feita pelo processo, no loopback.
      if (key.toLowerCase() === 'origin' || key.toLowerCase() === 'host' || key.toLowerCase() === 'referer') continue;
      headers.set(key, value);
    }
    const body = decode(message.body);
    if (body && !headers.has('content-length')) headers.set('content-length', String(body.byteLength));

    const request = new Request(`http://127.0.0.1${message.path}`, {
      method: message.method,
      headers,
      body: body && message.method !== 'GET' && message.method !== 'HEAD' ? asBlob(body) : undefined,
    });
    const response = await app.fetch(request);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    process.stdout.write(`${JSON.stringify({ id, status: response.status, headers: outHeaders, body: encode(bytes) })}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro no worker';
    const body = encode(Buffer.from(JSON.stringify({ error: message })));
    process.stdout.write(
      `${JSON.stringify({ id, status: 500, headers: { 'content-type': 'application/json' }, body })}\n`,
    );
  }
};

const media = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: app.fetch,
  idleTimeout: 255,
});

startBackgroundJobs();
process.stdout.write(`${JSON.stringify({ type: 'ready', mediaBase: `http://127.0.0.1:${media.port}` })}\n`);

const decoder = new TextDecoder();
let buffer = '';
const reader = Bun.stdin.stream().getReader();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() !== '') void handle(line);
    newline = buffer.indexOf('\n');
  }
}

// stdin fechou = o shell morreu: encerra para não deixar processo órfão.
process.exit(0);
