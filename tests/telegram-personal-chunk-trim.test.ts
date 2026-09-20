import { describe, expect, test } from 'bun:test';
import { trimChunkStream } from '../src/server/providers/telegram/personal.ts';

const fakeGenerator = async function* (chunks: Buffer[]): AsyncGenerator<Buffer, void, unknown> {
  for (const c of chunks) yield c;
};

const readAll = async (stream: ReadableStream<Uint8Array>): Promise<Buffer> => {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
};

describe('trimChunkStream', () => {
  test('sem trim (offset já alinhado, tamanho exato): repassa os chunks intactos', async () => {
    const gen = fakeGenerator([Buffer.from('abcd'), Buffer.from('efgh')]);
    const out = await readAll(trimChunkStream(gen, 0, 8));
    expect(out.toString()).toBe('abcdefgh');
  });

  test('descarta bytes do início (leadingTrim dentro do primeiro chunk)', async () => {
    const gen = fakeGenerator([Buffer.from('abcd'), Buffer.from('efgh')]);
    const out = await readAll(trimChunkStream(gen, 2, 6));
    expect(out.toString()).toBe('cdefgh');
  });

  test('leadingTrim maior que o primeiro chunk: descarta o primeiro chunk inteiro e parte do segundo', async () => {
    const gen = fakeGenerator([Buffer.from('ab'), Buffer.from('cdef')]);
    const out = await readAll(trimChunkStream(gen, 3, 3));
    expect(out.toString()).toBe('def');
  });

  test('corta o excedente no fim (wantedLength menor que a soma dos chunks)', async () => {
    const gen = fakeGenerator([Buffer.from('abcd'), Buffer.from('efgh')]);
    const out = await readAll(trimChunkStream(gen, 0, 5));
    expect(out.toString()).toBe('abcde');
  });

  test('leadingTrim e corte no fim combinados (caso real: range no meio de um chunk alinhado)', async () => {
    const gen = fakeGenerator([Buffer.from('0123456789')]);
    const out = await readAll(trimChunkStream(gen, 3, 4));
    expect(out.toString()).toBe('3456');
  });

  test('generator vazio produz stream vazia', async () => {
    const gen = fakeGenerator([]);
    const out = await readAll(trimChunkStream(gen, 0, 10));
    expect(out.length).toBe(0);
  });
});
