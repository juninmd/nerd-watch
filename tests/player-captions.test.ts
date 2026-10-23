import { describe, expect, test } from 'bun:test';
import {
  canSearch,
  firstPerLanguage,
  languageOption,
  OFF,
  preferredOption,
  toggleDecision,
} from '../src/client/player-captions-model.ts';
import { formatOffset, nextOffset, OFFSET_LIMIT_MS, shiftedCue } from '../src/client/player-captions-offset.ts';
import {
  CAPTION_LANG_KEY,
  CAPTION_STYLE_KEY,
  createCaptionPrefs,
  DEFAULT_CAPTION_STYLE,
  type KeyValueStore,
  parseCaptionLanguage,
  parseCaptionStyle,
} from '../src/client/player-captions-prefs.ts';

/**
 * Regras do player de legendas que não dependem do DOM. Cada caso diz por que a regra importa: a tecla "c"
 * não pode desligar uma legenda que não está ligada, e o atraso não pode levar um cue para antes de zero.
 */

describe('canSearch', () => {
  test.each([
    [null, false],
    [{}, false],
    [{ archiveId: 'item_1' }, false],
    [{ query: 'Filme' }, true],
    [{ tmdbId: 603 }, true],
  ])('contexto %j busca=%s', (ctx, expected) => {
    expect(canSearch(ctx as Parameters<typeof canSearch>[0])).toBe(expected);
  });
});

describe('firstPerLanguage', () => {
  test('mantém a primeira legenda de cada idioma, na ordem recebida (já ordenada pelo servidor)', () => {
    const results = [
      { languageCode: 'pt-BR', release: 'A' },
      { languageCode: 'en', release: 'B' },
      { languageCode: 'pt-BR', release: 'C' },
    ];
    expect(firstPerLanguage(results).map((r) => r.release)).toEqual(['A', 'B']);
  });

  test('lista vazia continua vazia', () => {
    expect(firstPerLanguage([])).toEqual([]);
  });
});

describe('toggleDecision (tecla "c")', () => {
  test.each([
    [
      'com legenda ligada desliga',
      { current: 'lang:pt-BR', last: 'lang:pt-BR', available: ['lang:pt-BR'] },
      { kind: 'off' },
    ],
    [
      'desligada e com última escolha disponível volta a ela',
      { current: OFF, last: 'lang:en', available: ['lang:pt-BR', 'lang:en'] },
      { kind: 'select', id: 'lang:en' },
    ],
    [
      'última escolha sumiu: usa a primeira disponível',
      { current: OFF, last: 'local', available: ['lang:pt-BR'] },
      { kind: 'select', id: 'lang:pt-BR' },
    ],
    [
      'sem nenhuma escolha prévia: primeira disponível',
      { current: OFF, last: null, available: ['archive', 'lang:pt-BR'] },
      { kind: 'select', id: 'archive' },
    ],
    ['sem nenhuma opção não decide nada', { current: OFF, last: null, available: [] }, { kind: 'none' }],
  ])('%s', (_label, state, expected) => {
    expect(toggleDecision(state)).toEqual(expected as ReturnType<typeof toggleDecision>);
  });

  test('desligar nunca escolhe uma opção nova (c só alterna o que já existe)', () => {
    const decision = toggleDecision({ current: 'lang:pt-BR', last: null, available: ['lang:pt-BR', 'lang:en'] });
    expect(decision).toEqual({ kind: 'off' });
  });
});

describe('preferredOption', () => {
  const options = [
    { id: 'archive', code: null },
    { id: 'lang:pt-BR', code: 'pt-BR' },
    { id: 'lang:en', code: 'en' },
  ];

  test('acha a opção do idioma preferido', () => {
    expect(preferredOption(options, 'en')).toBe('lang:en');
  });

  test('idioma preferido ausente da busca não escolhe nada (não cai em outro idioma)', () => {
    expect(preferredOption(options, 'fr')).toBeNull();
  });

  test('sem preferência não escolhe nada', () => {
    expect(preferredOption(options, null)).toBeNull();
  });

  test('a opção do arquivo local nunca casa com idioma (code null)', () => {
    expect(preferredOption([{ id: 'local', code: null }], 'pt-BR')).toBeNull();
  });

  test('languageOption monta o id estável', () => {
    expect(languageOption('pt-BR')).toBe('lang:pt-BR');
  });
});

describe('formatOffset e nextOffset (sincronia)', () => {
  test.each([
    [0, '0 s'],
    [100, '+0,1 s'],
    [500, '+0,5 s'],
    [-500, '−0,5 s'],
    [-1500, '−1,5 s'],
  ])('%i ms aparece como %s', (ms, expected) => {
    expect(formatOffset(ms)).toBe(expected);
  });

  test('passos de 100 e 500 ms somam sem erro de ponto flutuante', () => {
    let offset = 0;
    for (let i = 0; i < 10; i++) offset = nextOffset(offset, 100);
    expect(offset).toBe(1000);
    offset = nextOffset(offset, -500);
    expect(offset).toBe(500);
  });

  test('o deslocamento é limitado a ±60 s', () => {
    expect(nextOffset(OFFSET_LIMIT_MS, 500)).toBe(OFFSET_LIMIT_MS);
    expect(nextOffset(-OFFSET_LIMIT_MS, -100)).toBe(-OFFSET_LIMIT_MS);
  });

  test('"Zerar" não passa por aqui (o controlador usa 0 direto)', () => {
    expect(nextOffset(700, -700)).toBe(0);
  });
});

describe('shiftedCue (reescrita de tempo, sem refazer download)', () => {
  test.each([
    ['sem atraso mantém os tempos', 1, 2, 0, 1, 2],
    ['+500 ms atrasa o cue', 1, 2, 500, 1.5, 2.5],
    ['-500 ms adianta o cue', 1, 2, -500, 0.5, 1.5],
    ['cue que sairia de antes de zero começa em zero', 0.2, 1, -500, 0, 0.5],
    ['cue inteiro antes do zero some (duração zero)', 0.2, 0.4, -1000, 0, 0],
    ['cue com fim exatamente em zero não vira negativo', 0, 1, -1000, 0, 0],
  ])('%s', (_label, start, end, offsetMs, expStart, expEnd) => {
    const s = shiftedCue(start, end, offsetMs);
    expect(s.start).toBeCloseTo(expStart, 6);
    expect(s.end).toBeCloseTo(expEnd, 6);
  });

  test('cues sobrepostos continuam sobrepostos depois do deslocamento', () => {
    const a = shiftedCue(1, 5, 300);
    const b = shiftedCue(2, 4, 300);
    expect(a.start < b.end && b.start < a.end).toBe(true);
  });
});

describe('preferências de legenda (armazenamento injetado)', () => {
  const memory = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    };
  };

  test('idioma escolhido volta na próxima leitura', () => {
    const store = memory();
    createCaptionPrefs(store).setLanguage('pt-BR');
    expect(createCaptionPrefs(store).language()).toBe('pt-BR');
    expect(store.data.get(CAPTION_LANG_KEY)).toBe('pt-BR');
  });

  test.each([['<script>'], [''], ['pt BR'], ['abcdefghijklmnopqrstu'], ['1234']])(
    'código de idioma inválido %j não é gravado',
    (bad) => {
      const store = memory();
      createCaptionPrefs(store).setLanguage(bad);
      expect(store.data.has(CAPTION_LANG_KEY)).toBe(false);
      expect(createCaptionPrefs(store).language()).toBeNull();
    },
  );

  test('estilo guardado volta igual', () => {
    const store = memory();
    const prefs = createCaptionPrefs(store);
    prefs.setStyle({ size: 'xl', background: 50, color: 'yellow' });
    expect(createCaptionPrefs(store).style()).toEqual({ size: 'xl', background: 50, color: 'yellow' });
  });

  test('padrão é alto contraste: branco sobre 90% de preto', () => {
    expect(createCaptionPrefs(memory()).style()).toEqual({ size: 'md', background: 90, color: 'white' });
    expect(DEFAULT_CAPTION_STYLE.background).toBe(90);
  });

  test.each([
    ['JSON quebrado', '{nao json'],
    ['valor de fora da lista', '{"size":"gigante","background":7,"color":"azul"}'],
    ['tipo errado', '"texto"'],
    ['null literal', 'null'],
    ['vazio', ''],
  ])('valor guardado inválido (%s) cai no padrão sem quebrar', (_label, raw) => {
    expect(parseCaptionStyle(raw)).toEqual(DEFAULT_CAPTION_STYLE);
  });

  test('campo válido sobrevive quando o vizinho está inválido', () => {
    expect(parseCaptionStyle('{"size":"lg","background":"x","color":"yellow"}')).toEqual({
      size: 'lg',
      background: 90,
      color: 'yellow',
    });
  });

  test('sem nada guardado (armazenamento vazio ou bloqueado devolvendo null) usa o padrão', () => {
    expect(createCaptionPrefs({ getItem: () => null, setItem: () => {} }).style()).toEqual(DEFAULT_CAPTION_STYLE);
    expect(parseCaptionStyle(null)).toEqual(DEFAULT_CAPTION_STYLE);
    expect(CAPTION_STYLE_KEY).toBe('nw.captions.style');
  });

  test.each([
    ['pt-BR', 'pt-BR'],
    ['en', 'en'],
    ['por', 'por'],
    ['x y', null],
    [null, null],
  ])('parseCaptionLanguage(%j) = %j', (raw, expected) => {
    expect(parseCaptionLanguage(raw)).toBe(expected);
  });
});
