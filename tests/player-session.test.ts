import { describe, expect, test } from 'bun:test';
import { isAutoplayBlocked, positionState, seekToTarget, sessionSeekTarget } from '../src/client/player-session.ts';

describe('positionState (Media Session setPositionState)', () => {
  test('vídeo com duração finita devolve duração, posição e taxa válidas', () => {
    expect(positionState({ duration: 600, currentTime: 42, playbackRate: 1.5 })).toEqual({
      duration: 600,
      position: 42,
      playbackRate: 1.5,
    });
  });

  test('ao vivo (Infinity) ou duração desconhecida (NaN) não há barra: null', () => {
    expect(positionState({ duration: Number.POSITIVE_INFINITY, currentTime: 5, playbackRate: 1 })).toBeNull();
    expect(positionState({ duration: Number.NaN, currentTime: 0, playbackRate: 1 })).toBeNull();
    expect(positionState({ duration: 0, currentTime: 0, playbackRate: 1 })).toBeNull();
  });

  test('posição fora do vídeo é limitada (setPositionState lança se position > duration)', () => {
    expect(positionState({ duration: 100, currentTime: 130, playbackRate: 1 })?.position).toBe(100);
    expect(positionState({ duration: 100, currentTime: -2, playbackRate: 1 })?.position).toBe(0);
    expect(positionState({ duration: 100, currentTime: Number.NaN, playbackRate: 1 })?.position).toBe(0);
  });

  test('taxa zero ou inválida vira 1 (o navegador rejeita taxa não positiva)', () => {
    expect(positionState({ duration: 100, currentTime: 1, playbackRate: 0 })?.playbackRate).toBe(1);
    expect(positionState({ duration: 100, currentTime: 1, playbackRate: Number.NaN })?.playbackRate).toBe(1);
  });
});

describe('sessionSeekTarget (seekbackward / seekforward)', () => {
  test('usa o deslocamento pedido pelo sistema; sem ele, 10 s', () => {
    expect(sessionSeekTarget('seekbackward', 15, 100, 600)).toBe(85);
    expect(sessionSeekTarget('seekforward', undefined, 100, 600)).toBe(110);
  });

  test('deslocamento inválido (zero ou negativo) cai para 10 s', () => {
    expect(sessionSeekTarget('seekforward', 0, 100, 600)).toBe(110);
    expect(sessionSeekTarget('seekbackward', -4, 100, 600)).toBe(90);
  });

  test('ao vivo não há o que pular', () => {
    expect(sessionSeekTarget('seekforward', 10, 100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('seekToTarget (seekto com seekTime)', () => {
  test('leva ao tempo pedido, limitado ao vídeo', () => {
    expect(seekToTarget(50, 600)).toBe(50);
    expect(seekToTarget(9999, 600)).toBe(600);
    expect(seekToTarget(-1, 600)).toBe(0);
  });

  test('sem seekTime, sem duração finita ou com valor inválido: nada a fazer', () => {
    expect(seekToTarget(undefined, 600)).toBeNull();
    expect(seekToTarget(Number.NaN, 600)).toBeNull();
    expect(seekToTarget(10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('isAutoplayBlocked (play() rejeitado pelo navegador)', () => {
  test('NotAllowedError é o bloqueio de autoplay que pede um toque', () => {
    expect(isAutoplayBlocked({ name: 'NotAllowedError' })).toBe(true);
  });

  test('outros erros (interrompido por outro load, formato não suportado) não são bloqueio de autoplay', () => {
    expect(isAutoplayBlocked({ name: 'AbortError' })).toBe(false);
    expect(isAutoplayBlocked({ name: 'NotSupportedError' })).toBe(false);
    expect(isAutoplayBlocked(undefined)).toBe(false);
    expect(isAutoplayBlocked('NotAllowedError')).toBe(false);
  });
});
