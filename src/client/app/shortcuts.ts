import { createElement } from 'react';
import { openCommandPalette } from './command-palette.ts';
import { openDialog } from './open-dialog.ts';
import { navigate } from './router.ts';
import { ShortcutHelp } from './shortcut-help.tsx';
import { resolveKey } from './shortcut-keys.ts';
import { getThemePref, nextThemePref, setThemePref } from './theme.ts';

let helpOpen = false;

export const openShortcutHelp = (): void => {
  if (helpOpen) return;
  helpOpen = true;
  openDialog((close) =>
    createElement(ShortcutHelp, {
      onClose: () => {
        helpOpen = false;
        close();
      },
    }),
  );
};

const typingTarget = (el: Element | null): boolean =>
  Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable)) || Boolean(document.querySelector('dialog[open]'));

/** Registra os atalhos globais. Teclas digitadas em campos ou com um diálogo aberto são ignoradas (exceto Ctrl+K). */
export const installShortcuts = (): void => {
  let gPending = false;
  let gTimer: ReturnType<typeof setTimeout> | undefined;

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey || (e.shiftKey && e.key !== '?' && !mod)) return;
    const out = resolveKey(e.key, gPending, mod);
    if (out.kind === 'palette') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if (typingTarget(document.activeElement) || mod) return;

    gPending = false;
    clearTimeout(gTimer);
    if (out.kind === 'help') {
      e.preventDefault();
      openShortcutHelp();
    } else if (out.kind === 'theme') setThemePref(nextThemePref(getThemePref()));
    else if (out.kind === 'go') navigate(out.path);
    else if (out.kind === 'pending') {
      gPending = true;
      gTimer = setTimeout(() => {
        gPending = false;
      }, 1200);
    }
  });
};
