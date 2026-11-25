import { pushToast } from '../ui/toast-bridge.tsx';

/** Ação opcional no aviso (ex.: "Desfazer"); sem ela o aviso some sozinho mais cedo. */
export const showToast = (message: string, action?: { label: string; run: () => void }): void => {
  pushToast({
    title: message,
    duration: action ? 7000 : 2600,
    action: action ? { label: action.label, onClick: action.run } : undefined,
  });
};
