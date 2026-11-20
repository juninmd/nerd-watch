import { openCommandPalette } from './command-palette.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from './router.ts';
import { resolveKey, shortcutHelpRows } from './shortcut-keys.ts';
import { getThemePref, nextThemePref, setThemePref } from './theme.ts';

export const openShortcutHelp = (): void => {
  if (document.querySelector('dialog.help[open]')) return;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const rows = shortcutHelpRows(navigator.platform);
  const d = document.createElement('dialog');
  d.className = 'dialog help';
  d.setAttribute('closedby', 'any');
  d.setAttribute('aria-labelledby', 'help-title');
  d.innerHTML = `
    <form method="dialog" class="dialog-head"><h2 id="help-title">${icon('keyboard')} Atalhos de teclado</h2>
      <button class="btn btn-ghost btn-sm" aria-label="fechar">${icon('x', 'sm')}</button></form>
    <dl class="help-list">${rows.map(([k, v]) => `<div><dt><kbd>${escapeHtml(k)}</kbd></dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => {
    d.remove();
    if (opener?.isConnected) opener.focus();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  d.showModal();
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
