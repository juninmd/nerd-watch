import { describe, expect, test } from 'bun:test';
import { createPlaybackStore, resolveStart, resumePoint, startPoint } from '../../src/client/player/playback-store.ts';

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

describe('startPoint', () => {
  test('o t do link só avança; posição salva vence quando é maior', () => {
    expect(startPoint(null, 60)).toBe(60);
    expect(startPoint(30, 60)).toBe(60);
    expect(startPoint(90, 60)).toBe(90);
    expect(startPoint(30, 0)).toBe(30);
    expect(startPoint(null, 0)).toBe(0);
    expect(startPoint(Number.NaN, 60)).toBe(60);
  });

  test('sem link usa a posição salva', () => {
    expect(startPoint(30, null)).toBe(30);
    expect(startPoint(null, null)).toBeNull();
  });
});

describe('resolveStart', () => {
  test('link só avança e nunca volta o progresso salvo', () => {
    expect(resolveStart({ saved: 600, requested: 60, duration: 1200 })).toEqual({ resumeAt: 600, linkAt: null });
    expect(resolveStart({ saved: 30, requested: 60, duration: 1200 })).toEqual({ resumeAt: 60, linkAt: 60 });
    expect(resolveStart({ saved: null, requested: 60 })).toEqual({ resumeAt: 60, linkAt: 60 });
  });

  test('link perto do fim ou fora da duração não marca assistido', () => {
    expect(resolveStart({ saved: 600, requested: 1190, duration: 1200 })).toEqual({ resumeAt: 600, linkAt: null });
    expect(resolveStart({ saved: 600, requested: 1300, duration: 1200 })).toEqual({ resumeAt: 600, linkAt: null });
    expect(resolveStart({ saved: null, requested: 1300, duration: 1200 })).toEqual({ resumeAt: null, linkAt: null });
  });

  test('vídeo já assistido ignora o link', () => {
    expect(resolveStart({ saved: null, requested: 60, done: true, duration: 1200 })).toEqual({ resumeAt: null, linkAt: null });
  });

  test('sem duração ainda entrega o link para o player conferir no metadata', () => {
    expect(resolveStart({ saved: null, requested: 1190 })).toEqual({ resumeAt: 1190, linkAt: 1190 });
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

describe('limpar continuar assistindo', () => {
  const meta = { title: 't', subtitle: 's', poster: null, channelId: 'c', messageId: 'm' };
  const setup = () => {
    const writes: Array<[string, string]> = [];
    const store = createPlaybackStore(memoryStorage(), () => 1, (k, op) => writes.push([k, op]));
    store.save('a', 100, 3600, meta);
    store.save('b', 200, 3600, meta);
    store.save('fim', 3500, 3600, meta);
    writes.length = 0;
    return { store, writes };
  };

  test('clear remove só aquele vídeo e avisa a sincronização (delete)', () => {
    const { store, writes } = setup();
    store.clear('a');
    expect(store.inProgress().map((i) => i.key)).toEqual(['b']);
    expect(writes).toEqual([['a', 'delete']]);
  });

  test('clearInProgress apaga os em andamento e preserva o assistido até o fim', () => {
    const { store, writes } = setup();
    expect(store.clearInProgress()).toBe(2);
    expect(store.inProgress()).toEqual([]);
    expect(store.get('fim')?.done).toBe(true);
    expect(writes.sort()).toEqual([['a', 'delete'], ['b', 'delete']]);
  });

  test('clearInProgress sem nada em andamento não grava nem sincroniza', () => {
    const { store, writes } = setup();
    store.clearInProgress();
    writes.length = 0;
    expect(store.clearInProgress()).toBe(0);
    expect(writes).toEqual([]);
  });
});
