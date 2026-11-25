import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../app/state.ts';

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;

type OAuthState = { connected: boolean } & ({ status: 'idle' | 'pending' | 'connected' } | { status: 'error'; error: string });

/** Resultado da espera: conectou, o provedor devolveu erro, ou o teto de tempo passou. */
export type OAuthOutcome = { kind: 'connected' } | { kind: 'error'; message: string } | { kind: 'timeout' };

/**
 * Autorização OAuth pelo navegador: abre a URL do provedor numa aba nova e consulta o servidor até concluir.
 * Sair da tela (desmontar) para o polling.
 */
export const useOAuthFlow = (start: () => Promise<{ authUrl: string }>, check: () => Promise<OAuthState>, onOutcome: (o: OAuthOutcome) => void) => {
  const [starting, setStarting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const latest = useRef({ check, onOutcome });
  latest.current = { check, onOutcome };

  const stop = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setWaiting(false);
  }, []);

  // Sair da tela antes de o servidor responder não pode abrir a janela de login nem deixar polling órfão.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  const poll = useCallback(
    (gen: number, startedAt: number) => {
      const finish = (o: OAuthOutcome) => {
        stop();
        latest.current.onOutcome(o);
      };
      timer.current = setTimeout(() => {
        latest.current
          .check()
          .then((state) => {
            if (gen !== generation.current) return;
            if (state.status === 'connected' || state.connected) return finish({ kind: 'connected' });
            if (state.status === 'error') return finish({ kind: 'error', message: state.error });
            if (Date.now() - startedAt > POLL_MAX_MS) return finish({ kind: 'timeout' });
            poll(gen, startedAt);
          })
          .catch(() => {
            if (gen !== generation.current) return;
            // Servidor fora do ar durante a autorização: o teto de tempo vale também aqui, senão o polling nunca para.
            if (Date.now() - startedAt > POLL_MAX_MS) return finish({ kind: 'timeout' });
            poll(gen, startedAt);
          });
      }, POLL_MS);
    },
    [stop],
  );

  const connect = useCallback(() => {
    setStarting(true);
    start()
      .then(({ authUrl }) => {
        if (!mounted.current) return;
        window.open(authUrl, '_blank', 'noopener');
        stop();
        setWaiting(true);
        poll(generation.current, Date.now());
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'não foi possível iniciar'))
      .finally(() => {
        if (mounted.current) setStarting(false);
      });
  }, [start, stop, poll]);

  return { starting, waiting, connect, stop };
};
