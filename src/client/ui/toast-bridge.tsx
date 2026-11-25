/** Liga o `showToast` imperativo (app/state.ts) ao `useToast` do Sonido, que só existe dentro do `ToastProvider`. */
import { type ToastOptions, useToast } from '@juninmd/sonido';
import { useEffect } from 'react';

type Push = (t: ToastOptions) => void;
let push: Push | null = null;
const pending: ToastOptions[] = [];

export const pushToast = (t: ToastOptions): void => {
  if (push) push(t);
  else pending.push(t);
};

export function ToastBridge() {
  const toast = useToast();
  useEffect(() => {
    push = toast;
    for (const t of pending.splice(0)) toast(t);
    return () => {
      push = null;
    };
  }, [toast]);
  return null;
}
