import { Button } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Cartão de fim por cima do vídeo (fim do canal ou do episódio), com contagem opcional até seguir sozinho. */

interface EndCountdown {
  /** Segundos restantes; null quando não há contagem (reprodução automática desligada). */
  left: number | null;
}

/** Estado do cartão de fim: `start` mostra (com contagem se `auto`), `stop` some. Ao zerar chama `onDone`. */
export const useEndCountdown = (onDone: () => void) => {
  const [end, setEnd] = useState<EndCountdown | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const counting = end !== null && end.left !== null;

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      setEnd((cur) => (cur && cur.left !== null ? { left: cur.left - 1 } : cur));
    }, 1000);
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => {
    if (end?.left !== null && end?.left !== undefined && end.left <= 0) {
      setEnd(null);
      done.current();
    }
  }, [end]);

  const start = useCallback((seconds: number, auto: boolean) => setEnd({ left: auto ? seconds : null }), []);
  const stop = useCallback(() => setEnd(null), []);
  return { end, start, stop };
};

export interface WatchEndCardProps {
  caption: string;
  title: string;
  /** Texto da contagem já com o número (ex.: "começa em 5s"); vazio sem contagem. */
  countText: string;
  onGo(): void;
  onStay(): void;
}

export function WatchEndCard({ caption, title, countText, onGo, onStay }: WatchEndCardProps) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => go.current?.focus(), []);
  return (
    <div className="watch-end">
      <div className="watch-end-card" role="alert">
        <small>{caption}</small>
        <b>{title}</b>
        <span>{countText}</span>
        <div className="watch-end-actions">
          <Button ref={go} variant="primary" size="sm" onClick={onGo}>
            Assistir agora
          </Button>
          <Button variant="ghost" size="sm" onClick={onStay}>
            Ficar aqui
          </Button>
        </div>
      </div>
    </div>
  );
}
