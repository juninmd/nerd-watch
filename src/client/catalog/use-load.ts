import { useEffect, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  error: boolean;
  /** Busca de novo sem apagar o que está na tela (ex.: mudou o status na lista). */
  reload: () => void;
  /** Depois de erro: volta ao esqueleto e tenta de novo. */
  retry: () => void;
}

/**
 * Carga de uma tela por `useEffect`: resposta de pedido antigo (outra chave ou recarga mais nova) é descartada,
 * então navegar antes da resposta nunca pinta dado da tela anterior.
 */
export const useLoad = <T>(load: () => Promise<T>, key: string): Loaded<T> => {
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<{ key: string; data: T | null; error: boolean }>({ key, data: null, error: false });
  const request = `${key}#${tick}`;
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setRes({ key, data, error: false }))
      .catch(() => live && setRes({ key, data: null, error: true }));
    return () => {
      live = false;
    };
  }, [request]);
  // Outra chave (fonte, busca): nada da anterior fica na tela; volta ao esqueleto até a resposta nova.
  const current = res.key === key ? res : { data: null, error: false };
  return {
    data: current.data,
    error: current.error,
    reload: () => setTick((t) => t + 1),
    retry: () => {
      setRes({ key, data: null, error: false });
      setTick((t) => t + 1);
    },
  };
};
