import { openCommandPalette } from './command-palette.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from './router.ts';
import { resolveKey } from './shortcut-keys.ts';
import { getShowSpoilers, setShowSpoilers } from './state.ts';
import { getThemePref, nextThemePref, setThemePref } from './theme.ts';

const ROWS: Array<[string, string]> = [
  ['Ctrl K  ou  /', 'paleta de comandos'],
  ['g  h', 'Início'],
  ['g  b', 'Biblioteca'],
  ['g  l', 'Listas'],
  ['g  a', 'Agenda'],
  ['g  e', 'Estatísticas'],
  ['g  s', 'Buscar títulos'],
  ['g  p', 'Domínio público'],
  ['g  t', 'Canais e player'],
  ['g  c', 'Conexões'],
  ['g  d', 'Importar e backup'],
  ['g  j', 'Ajustes e avisos'],
  ['v', 'tema: escuro, claro, sistema'],
  ['s', 'alternar spoilers'],
  ['espaço  k', 'player: reproduzir / pausar'],
  ['j  l', 'player: voltar / avançar 10 s'],
  ['←  →', 'player: voltar / avançar 5 s'],
  ['↑  ↓', 'player: volume'],
  ['0 … 9', 'player: ir para 0% … 90%'],
  ['m  f  c', 'player: mudo, tela cheia, legendas'],
  ['&lt;  &gt;', 'player: velocidade menor / maior'],
  ['n', 'player: próximo vídeo'],
  ['?', 'esta ajuda'],
];

export const openShortcutHelp = (): void => {
  if (document.querySelector('dialog.help[open]')) return;
  const d = document.createElement('dialog');
  d.className = 'dialog help';
  d.setAttribute('closedby', 'any');
  d.setAttribute('aria-labelledby', 'help-title');
  d.innerHTML = `
    <form method="dialog" class="dialog-head"><h2 id="help-title">${icon('keyboard')} Atalhos de teclado</h2>
      <button class="btn btn-ghost btn-sm" aria-label="fechar">${icon('x', 'sm')}</button></form>
    <dl class="help-list">${ROWS.map(([k, v]) => `<div><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`).join('')}</dl>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
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
    } else if (out.kind === 'spoilers') setShowSpoilers(!getShowSpoilers());
    else if (out.kind === 'theme') setThemePref(nextThemePref(getThemePref()));
    else if (out.kind === 'go') navigate(out.path);
    else if (out.kind === 'pending') {
      gPending = true;
      gTimer = setTimeout(() => {
        gPending = false;
      }, 1200);
    }
  });
};
