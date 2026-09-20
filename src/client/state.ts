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

export const showToast = (message: string): void => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};
