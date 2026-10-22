import { describe, expect, test } from 'bun:test';
import { createPlaybackStore, resumePoint } from '../src/client/playback-store.ts';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('resumePoint', () => {
  test('retoma no ponto salvo (arredondado para baixo)', () => {
    expect(resumePoint({ seconds: 125.9, duration: 3600, at: 0 })).toBe(125);
  });

  test.each([
    ['quase nada assistido', { seconds: 4, duration: 3600, at: 0 }],
    ['já terminou (≥ 95%)', { seconds: 3500, duration: 3600, at: 0 }],
  ])('começa do início: %s', (_label, p) => {
    expect(resumePoint(p)).toBeNull();
  });

  test('sem duração conhecida ainda retoma; sem registro não', () => {
    expect(resumePoint({ seconds: 90, duration: null, at: 0 })).toBe(90);
    expect(resumePoint(undefined)).toBeNull();
  });
});

describe('createPlaybackStore', () => {
  test('guarda e devolve a posição', () => {
    const store = createPlaybackStore(memoryStorage(), () => 1000);
    store.save('a', 300, 3600);
    expect(store.get('a')).toEqual({ seconds: 300, duration: 3600, at: 1000 });
  });

  test('terminar o vídeo marca como assistido e não oferece retomar nos créditos', () => {
    const store = createPlaybackStore(memoryStorage());
    store.save('a', 300, 3600);
    store.save('a', 3500, 3600);
    expect(store.get('a')?.done).toBe(true);
    expect(resumePoint(store.get('a'))).toBeNull();
    expect(store.inProgress()).toEqual([]);
  });

  test('abrir de novo um vídeo assistido não apaga a marca; assistir de verdade sim', () => {
    const store = createPlaybackStore(memoryStorage());
    store.save('a', 3500, 3600);
    store.save('a', 2, 3600);
    expect(store.get('a')?.done).toBe(true);
    store.save('a', 600, 3600);
    expect(store.get('a')?.done).toBeUndefined();
  });

  test('inProgress lista só o que tem metadados e pode ser retomado, o mais recente primeiro', () => {
    let t = 0;
    const store = createPlaybackStore(memoryStorage(), () => ++t);
    const meta = (id: string) => ({ title: `Ep ${id}`, subtitle: 'Canal', poster: null, channelId: 'c', messageId: id });
    store.save('c:1', 300, 1400, meta('1'));
    store.save('c:2', 4, 1400, meta('2'));
    store.save('c:3', 900, 1400);
    store.save('c:4', 1390, 1400, meta('4'));
    store.save('c:5', 60, 1400, meta('5'));
    expect(store.inProgress().map((e) => e.key)).toEqual(['c:5', 'c:1']);
    expect(store.inProgress()[0]).toMatchObject({ resumeAt: 60, meta: { messageId: '5' } });
    expect(store.inProgress(1)).toHaveLength(1);
  });

  test('ignora valores inválidos', () => {
    const store = createPlaybackStore(memoryStorage());
    store.save('a', Number.NaN, 100);
    store.save('b', -3, 100);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
  });

  test('descarta as posições mais antigas ao passar de 200 entradas', () => {
    let t = 0;
    const store = createPlaybackStore(memoryStorage(), () => ++t);
    for (let i = 0; i < 205; i++) store.save(`k${i}`, 50, 3600);
    expect(store.get('k0')).toBeUndefined();
    expect(store.get('k4')).toBeUndefined();
    expect(store.get('k5')).toBeDefined();
    expect(store.get('k204')).toBeDefined();
  });

  test('JSON corrompido ou armazenamento que lança não quebram', () => {
    const corrupted = { getItem: () => '{not json', setItem: () => {} };
    expect(createPlaybackStore(corrupted).get('x')).toBeUndefined();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => createPlaybackStore(throwing).save('x', 50, 100)).not.toThrow();
  });
});
