import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTrackSlot, type MountedTrack } from '../src/client/components/player-captions-track.ts';

/**
 * Corrida de escolhas da legenda: o `<track>` antigo não pode continuar tocando quando outra escolha entra,
 * e "remover se for esta" não pode derrubar a faixa nova. DOM fake: só o que o módulo usa.
 */

interface FakeCue {
  startTime: number;
  endTime: number;
}

interface FakeTrackEl {
  kind: string;
  label: string;
  srclang: string;
  src: string;
  removed: boolean;
  listeners: Record<string, () => void>;
  track: { mode: string; cues: FakeCue[] };
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string): void;
  remove(): void;
}

const created: FakeTrackEl[] = [];
const makeEl = (): FakeTrackEl => {
  const el: FakeTrackEl = {
    kind: '',
    label: '',
    srclang: '',
    src: '',
    removed: false,
    listeners: {},
    track: { mode: 'disabled', cues: [{ startTime: 1, endTime: 3 }] },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
    remove() {
      this.removed = true;
    },
  };
  created.push(el);
  return el;
};

const fakeVideo = { appendChild: () => undefined } as unknown as HTMLVideoElement;
const realDocument = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElement: () => makeEl() };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

describe('createTrackSlot (escolhas que se atropelam)', () => {
  test('carga concluída põe a faixa em showing e aplica o atraso aos cues', async () => {
    const slot = createTrackSlot();
    const pending = slot.attach(fakeVideo, 'WEBVTT', 'pt', 'pt-BR', 500);
    const el = created[created.length - 1] as FakeTrackEl;
    el.listeners.load?.();
    const track = (await pending) as MountedTrack;
    expect(track).not.toBeNull();
    expect(el.track.mode).toBe('showing');
    expect(el.track.cues[0]).toEqual({ startTime: 1.5, endTime: 3.5 });
    slot.drop();
    expect(el.removed).toBe(true);
  });

  test('carga antiga que termina depois de outra escolha não volta a tocar', async () => {
    const slot = createTrackSlot();
    const first = slot.attach(fakeVideo, 'A', 'primeira', null, 0);
    const elA = created[created.length - 1] as FakeTrackEl;
    // Segunda escolha entra antes de a primeira carregar: a primeira já tem que estar fora.
    const second = slot.attach(fakeVideo, 'B', 'segunda', null, 0);
    const elB = created[created.length - 1] as FakeTrackEl;
    expect(elA.removed).toBe(true);
    // Se a primeira ainda disparar o load, não pode virar a faixa ativa.
    elA.listeners.load?.();
    expect(await first).toBeNull();
    elB.listeners.load?.();
    expect(await second).not.toBeNull();
    expect(elB.removed).toBe(false);
  });

  test('dropIf de uma faixa já substituída não remove a faixa nova', async () => {
    const slot = createTrackSlot();
    const old = slot.attach(fakeVideo, 'A', 'a', null, 0);
    const elA = created[created.length - 1] as FakeTrackEl;
    elA.listeners.load?.();
    const oldTrack = (await old) as MountedTrack;
    const fresh = slot.attach(fakeVideo, 'B', 'b', null, 0);
    const elB = created[created.length - 1] as FakeTrackEl;
    slot.dropIf(oldTrack);
    expect(elB.removed).toBe(false);
    elB.listeners.load?.();
    expect(await fresh).not.toBeNull();
  });

  test('erro de carga remove a faixa e resolve null', async () => {
    const slot = createTrackSlot();
    const pending = slot.attach(fakeVideo, 'x', 'x', null, 0);
    const el = created[created.length - 1] as FakeTrackEl;
    el.listeners.error?.();
    expect(await pending).toBeNull();
    expect(el.removed).toBe(true);
  });
});
