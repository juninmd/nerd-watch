import { escapeHtml } from './card.ts';
import { CAPTION_BACKGROUNDS, type CaptionStyle } from '../player-captions-prefs.ts';
import { formatOffset, OFFSET_BIG_STEP_MS, OFFSET_STEP_MS } from '../player-captions-offset.ts';
import { OFF } from '../player-captions-model.ts';

/** Marcação e teclado do menu de legendas. Não decide nada: o controlador passa o estado e recebe as ações. */

export interface CaptionsOption {
  id: string;
  label: string;
  detail: string;
}

export interface CaptionsViewModel {
  current: string;
  currentLabel: string;
  options: CaptionsOption[];
  canSearch: boolean;
  searchBusy: boolean;
  message: string;
  offsetMs: number;
  style: CaptionStyle;
}

export interface CaptionsViewHandlers {
  select(id: string): void;
  search(): void;
  pickFile(file: File): void;
  offset(deltaMs: number | 'reset'): void;
  style(next: CaptionStyle): void;
}

export interface CaptionsView {
  root: HTMLElement;
  mount(host: HTMLElement | null): void;
  render(vm: CaptionsViewModel): void;
  announce(text: string): void;
  close(): void;
}

const ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitem"]';
const ACCEPT = '.srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip';

const OFFSET_BUTTONS: Array<[string, number | 'reset']> = [
  [`−${OFFSET_BIG_STEP_MS} ms`, -OFFSET_BIG_STEP_MS],
  [`−${OFFSET_STEP_MS} ms`, -OFFSET_STEP_MS],
  ['Zerar', 'reset'],
  [`+${OFFSET_STEP_MS} ms`, OFFSET_STEP_MS],
  [`+${OFFSET_BIG_STEP_MS} ms`, OFFSET_BIG_STEP_MS],
];

const SIZE_OPTIONS: Array<[string, string]> = [
  ['sm', 'Pequena'],
  ['md', 'Média'],
  ['lg', 'Grande'],
  ['xl', 'Muito grande'],
];
const BACKGROUND_OPTIONS: Array<[string, string]> = CAPTION_BACKGROUNDS.map((b) => [String(b), `${b}%`]);
const COLOR_OPTIONS: Array<[string, string]> = [
  ['white', 'Branca'],
  ['yellow', 'Amarela'],
];

const select = (name: string, value: string, options: Array<[string, string]>): string =>
  `<select data-style="${name}">${options.map(([v, label]) => `<option value="${v}"${v === value ? ' selected' : ''}>${label}</option>`).join('')}</select>`;

const styleControls = (style: CaptionStyle): string => `
  <label>Tamanho ${select('size', style.size, SIZE_OPTIONS)}</label>
  <label>Fundo ${select('background', String(style.background), BACKGROUND_OPTIONS)}</label>
  <label>Cor ${select('color', style.color, COLOR_OPTIONS)}</label>`;

/** Seletor de um item do menu, para devolver o foco ao mesmo lugar depois de reescrever a marcação. */
const focusKey = (el: HTMLElement): string =>
  `${el.dataset.id ?? ''}|${el.dataset.act ?? ''}|${el.dataset.offset ?? ''}|${el.dataset.style ?? ''}`;

const renderItem = (id: string, label: string, detail: string | null, current: boolean): string => `
  <button type="button" role="menuitemradio" aria-checked="${current}" data-id="${escapeHtml(id)}" class="captions-item">
    <span class="captions-mark" aria-hidden="true">${current ? '●' : ''}</span>
    <span>${escapeHtml(label)}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>
  </button>`;

const renderPopup = (vm: CaptionsViewModel): string => {
  const items = vm.options.map((o) => renderItem(o.id, o.label, o.detail, o.id === vm.current)).join('');
  const search = vm.canSearch
    ? `<button type="button" role="menuitem" data-act="search" class="captions-item"${vm.searchBusy ? ' disabled' : ''}>
         <span class="captions-mark" aria-hidden="true"></span><span>${vm.searchBusy ? 'Buscando legendas…' : 'Buscar legendas'}</span>
       </button>`
    : '';
  return `
    <div role="menu" aria-label="Legendas" class="captions-menu">
      ${renderItem(OFF, 'Desligadas', null, vm.current === OFF)}
      ${items}
      ${search}
      <button type="button" role="menuitem" data-act="file" class="captions-item">
        <span class="captions-mark" aria-hidden="true"></span><span>Arquivo .srt ou .vtt…</span>
      </button>
    </div>
    ${vm.message ? `<p class="captions-hint" role="status">${escapeHtml(vm.message)}</p>` : ''}
    <div class="captions-drop" data-drop>Ou arraste um arquivo .srt ou .vtt para cá</div>
    <input type="file" accept="${ACCEPT}" hidden data-file />
    <div role="group" aria-label="Sincronia da legenda. Mais atrasa a legenda, menos adianta." class="captions-offset">
      <span>Sincronia <output>${formatOffset(vm.offsetMs)}</output></span>
      ${OFFSET_BUTTONS.map(([label, delta]) => `<button type="button" data-offset="${delta}" class="captions-chip">${label}</button>`).join('')}
    </div>
    <div role="group" aria-label="Aparência da legenda" class="captions-style">${styleControls(vm.style)}</div>`;
};

export const createCaptionsView = (handlers: CaptionsViewHandlers): CaptionsView => {
  const root = document.createElement('div');
  root.className = 'player-captions';
  const popupId = `captions-popup-${Math.random().toString(36).slice(2, 8)}`;
  root.innerHTML = `
    <button type="button" class="captions-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${popupId}">CC</button>
    <div class="captions-popup" id="${popupId}" hidden></div>
    <span class="sr-only" role="status" aria-live="polite" data-live></span>`;
  const button = root.querySelector<HTMLButtonElement>('.captions-btn') as HTMLButtonElement;
  const popup = root.querySelector<HTMLElement>('.captions-popup') as HTMLElement;
  const live = root.querySelector<HTMLElement>('[data-live]') as HTMLElement;

  const isOpen = (): boolean => !popup.hidden;
  const close = (): void => {
    if (!isOpen()) return;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const open = (): void => {
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    (
      popup.querySelector<HTMLElement>('[aria-checked="true"]') ?? popup.querySelector<HTMLElement>(ITEM_SELECTOR)
    )?.focus();
  };

  const readStyle = (): CaptionStyle => {
    const value = (name: string, fallback: string): string =>
      popup.querySelector<HTMLSelectElement>(`[data-style="${name}"]`)?.value ?? fallback;
    return {
      size: value('size', 'md') as CaptionStyle['size'],
      background: Number(value('background', '90')) as CaptionStyle['background'],
      color: value('color', 'white') as CaptionStyle['color'],
    };
  };

  const render = (vm: CaptionsViewModel): void => {
    button.setAttribute('aria-label', `Legendas: ${vm.currentLabel}`);
    button.dataset.active = String(vm.current !== OFF);
    // Reescrever o menu tira o foco de quem o usava; o foco volta ao item de mesma chave, se existir.
    const focused = popup.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const key = focused ? focusKey(focused) : null;
    popup.innerHTML = renderPopup(vm);
    if (key) {
      const again = Array.from(
        popup.querySelectorAll<HTMLElement>('[data-id], [data-act], [data-offset], [data-style]'),
      ).find((el) => focusKey(el) === key);
      again?.focus();
    }
  };

  const announce = (text: string): void => {
    live.textContent = '';
    queueMicrotask(() => {
      live.textContent = text;
    });
  };

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (button.contains(target)) {
      if (isOpen()) close();
      else open();
      return;
    }
    const item = target.closest<HTMLElement>('[role^="menuitem"]');
    if (item?.dataset.id !== undefined) return handlers.select(item.dataset.id);
    if (item?.dataset.act === 'search') return handlers.search();
    if (item?.dataset.act === 'file') return popup.querySelector<HTMLInputElement>('[data-file]')?.click();
    const offset = target.closest<HTMLElement>('[data-offset]')?.dataset.offset;
    if (offset !== undefined) handlers.offset(offset === 'reset' ? 'reset' : Number(offset));
  });

  popup.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.matches('[data-file]')) {
      const file = target.files?.[0];
      target.value = '';
      if (file) handlers.pickFile(file);
      return;
    }
    if (target.dataset.style !== undefined) handlers.style(readStyle());
  });

  // Setas e Home/End andam pelos itens; Esc fecha e devolve o foco ao botão. O preventDefault impede o
  // atalho do próprio player (setas = volume) de disparar junto.
  root.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
      return;
    }
    const items = Array.from(popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    const at = items.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const last = items.length - 1;
    const to =
      e.key === 'ArrowDown'
        ? (at + 1) % items.length
        : e.key === 'ArrowUp'
          ? (at - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  });

  popup.addEventListener('dragover', (e) => e.preventDefault());
  popup.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handlers.pickFile(file);
  });

  // Foco saiu do componente (Tab ou clique fora) fecha o menu. Nó já removido (re-render) não conta.
  root.addEventListener('focusout', (e) => {
    const from = e.target as Node;
    if (!from.isConnected) return;
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (next && root.contains(next)) return;
    close();
  });

  /** Põe o menu na barra fixa ou no palco; sem lugar (player fechado), sai do documento. */
  const mount = (host: HTMLElement | null): void => {
    if (!host) {
      close();
      root.remove();
      return;
    }
    if (root.parentElement !== host) {
      close();
      host.appendChild(root);
    }
  };

  return { root, render, announce, close, mount };
};
