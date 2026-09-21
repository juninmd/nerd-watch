import { describe, expect, test } from 'bun:test';
import { buildPersonalStream, planRange, trimChunkStream } from '../src/server/providers/telegram/personal.ts';

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

  test('regressão: streamPersonalItem tinha um bug real passando leadingTrim+wantedLength (downloadLimit) onde trimChunkStream espera wantedLength', async () => {
    // Bug real encontrado em revisão: o 3º argumento de trimChunkStream é o tamanho de SAÍDA (pós-corte),
    // não quanto pedir ao Telegram. O teleproto real (downloads.js) sempre entrega chunks cheios até
    // `downloaded >= limit`, então usar `downloadLimit` (que inclui o leadingTrim) como cap de saída
    // vazava até `leadingTrim` bytes a mais que o Content-Length declarado — corrompendo a resposta em
    // qualquer seek não alinhado a 4096 (essencialmente todo scrub do player).
    const plan = planRange({ start: 1000, end: 2047 }, 1_000_000_000);
    if (!plan) throw new Error('range deveria ser satisfazível');

    // Chunk "cheio" simulando iterDownload entregando mais do que o necessário, como o real faz.
    const gen = fakeGenerator([Buffer.alloc(4096, 'x')]);
    const correctOutput = await readAll(trimChunkStream(gen, plan.leadingTrim, plan.wantedLength));
    expect(correctOutput.length).toBe(plan.wantedLength);

    // O bug corrigido: usar downloadLimit no lugar de wantedLength produzia um corpo maior que o Content-Length.
    const gen2 = fakeGenerator([Buffer.alloc(4096, 'x')]);
    const buggyOutput = await readAll(trimChunkStream(gen2, plan.leadingTrim, plan.downloadLimit));
    expect(buggyOutput.length).toBe(plan.downloadLimit);
    expect(buggyOutput.length).not.toBe(plan.wantedLength);
  });

  test('regressão: buildPersonalStream (usado pelo call site real de streamPersonalItem) devolve exatamente wantedLength bytes, não downloadLimit', async () => {
    // Diferente do teste acima (que recria os dois lados manualmente), este chama a mesma função que
    // streamPersonalItem chama de fato — reintroduzir o bug no call site (trocar wantedLength por
    // downloadLimit dentro de buildPersonalStream) faz este teste falhar.
    const plan = planRange({ start: 1000, end: 2047 }, 1_000_000_000);
    if (!plan) throw new Error('range deveria ser satisfazível');

    const gen = fakeGenerator([Buffer.alloc(4096, 'x')]);
    const result = buildPersonalStream(gen, plan, 'video/mp4', 1_000_000_000);
    const out = await readAll(result.stream);
    expect(out.length).toBe(plan.wantedLength);
    expect(out.length).not.toBe(plan.downloadLimit);
    expect(result.start).toBe(plan.start);
    expect(result.end).toBe(plan.end);
    expect(result.contentType).toBe('video/mp4');
    expect(result.totalSize).toBe(1_000_000_000);
  });
});

describe('planRange', () => {
  test('range simples dentro de um único bloco de 4096: sem trim, downloadLimit == wantedLength', () => {
    const plan = planRange({ start: 0, end: 999 }, 1_000_000);
    expect(plan).toEqual({ start: 0, end: 999, wantedLength: 1000, alignedOffset: 0, leadingTrim: 0, downloadLimit: 1000 });
  });

  test('range começando no meio de um bloco de 4096: leadingTrim > 0, downloadLimit > wantedLength', () => {
    const plan = planRange({ start: 5000, end: 5999 }, 1_000_000);
    expect(plan).toEqual({ start: 5000, end: 5999, wantedLength: 1000, alignedOffset: 4096, leadingTrim: 904, downloadLimit: 1904 });
  });

  test('range sem fim explícito (Range: bytes=N-): usa totalSize - 1 como fim', () => {
    const plan = planRange({ start: 999_990, end: null }, 1_000_000);
    expect(plan?.end).toBe(999_999);
    expect(plan?.wantedLength).toBe(10);
  });

  test('range inteiramente além do arquivo: não satisfazível, devolve null', () => {
    const plan = planRange({ start: 2_000_000, end: null }, 1_000_000);
    expect(plan).toBeNull();
  });

  test('start igual ao último byte válido: ainda satisfazível (1 byte)', () => {
    const plan = planRange({ start: 999_999, end: null }, 1_000_000);
    expect(plan?.wantedLength).toBe(1);
  });

  test('regressão: range invertido (end < start, ex. Range: bytes=500-100) não é satisfazível', () => {
    // A regex da rota (^bytes=(\d+)-(\d*)$) aceita isso sintaticamente; sem essa guarda, wantedLength
    // saía negativo e a resposta virava 206 com Content-Length negativo/Content-Range inválido.
    const plan = planRange({ start: 500, end: 100 }, 1_000_000);
    expect(plan).toBeNull();
  });
});
