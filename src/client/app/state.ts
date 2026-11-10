const SPOILER_KEY = 'nerd-watch:show-spoilers';

type Listener = () => void;
const listeners = new Set<Listener>();

const readSpoilerPref = (): boolean => {
  try {
    return localStorage.getItem(SPOILER_KEY) === 'true';
  } catch {
    return false;
  }
};

let showSpoilers = readSpoilerPref();

export const getShowSpoilers = (): boolean => showSpoilers;

export const setShowSpoilers = (value: boolean): void => {
  showSpoilers = value;
  try {
    localStorage.setItem(SPOILER_KEY, String(value));
  } catch {
    /* localStorage indisponível (modo privado); preferência só dura a sessão */
  }
  for (const l of listeners) l();
};

export const onSpoilerChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Ação opcional no aviso (ex.: "Desfazer"); sem ela o aviso some sozinho mais cedo. */
export const showToast = (message: string, action?: { label: string; run: () => void }): void => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), action ? 7000 : 2600);
};
