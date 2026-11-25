import { type RefObject, useEffect, useRef } from 'react';

/** `ref.current` fica `false` depois que o componente sai da tela: resposta de rede atrasada não mexe em estado morto. */
export const useAlive = (): RefObject<boolean> => {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
};
