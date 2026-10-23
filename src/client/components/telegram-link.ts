import { type LibraryItemDto, linkTelegramItem, listLibrary, type TelegramItemLinkDto, unlinkTelegramItem } from '../api.ts';
import { normalizeSearch } from '../telegram-items.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

const episodeLabel = (l: TelegramItemLinkDto): string => `T${l.seasonNumber} · Ep ${l.episodeNumber}${l.episodeEnd ? `–${l.episodeEnd}` : ''}`;

/**
 * Selo do vínculo na lista do canal: confirmado (com o pôster e o nome do título) ou sugestão para confirmar.
 * A confiança aparece só na sugestão, em texto: o usuário decide com a informação na frente.
 */
/** Só https sem aspas, parênteses ou barras: a URL entra num `url('…')` de atributo style, então nada pode escapar dele. */
const safePoster = (url: string | null): string | null => (url && /^https:\/\/[^\s'"()\\<>]+$/.test(url) ? url : null);

export const linkBadge = (link: TelegramItemLinkDto | null): string => {
  if (!link) return '';
  const name = escapeHtml(link.title ?? 'título da biblioteca');
  const src = safePoster(link.posterUrl);
  const poster = src ? `<span class="tg-link-poster" style="background-image:url('${escapeHtml(src)}')" aria-hidden="true"></span>` : '';
  if (link.status === 'linked') {
    return `<div class="tg-link-line">${poster}<span class="badge badge-watching">vinculado · ${name} · ${episodeLabel(link)}</span></div>`;
  }
  const pct = link.confidence === null ? '' : ` (${Math.round(link.confidence * 100)}%)`;
  return `<div class="tg-link-line">${poster}<span class="badge">sugerido${pct}: ${name} · ${episodeLabel(link)} — confirme</span></div>`;
};

export interface LinkDialogOptions {
  channelId: string;
  messageId: string;
  current: TelegramItemLinkDto | null;
  onDone: () => void;
}

const option = (it: LibraryItemDto, selected: string | null): string =>
  `<button type="button" class="tg-link-option" data-id="${escapeHtml(it.titleId)}" aria-pressed="${it.titleId === selected}">${escapeHtml(it.title.title)}</button>`;

/**
 * Diálogo nativo (`<dialog>`): foco preso, Esc fecha e leitura por leitor de tela vêm de graça. Só séries da biblioteca
 * entram na lista, porque o servidor recusa qualquer outro título.
 */
export const openLinkDialog = (opts: LinkDialogOptions): void => {
  const trigger = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'tg-link-dialog';
  dialog.setAttribute('aria-labelledby', 'tg-link-title');
  dialog.innerHTML = `
    <form class="tg-link-form" method="dialog">
      <h2 id="tg-link-title">Vincular a um título</h2>
      <p class="hint">Escolha uma série da sua biblioteca e o episódio que este vídeo mostra.</p>
      <label class="tg-link-field" for="tg-link-q">Buscar na biblioteca</label>
      <input id="tg-link-q" class="input input-pill" type="search" autocomplete="off" />
      <div class="tg-link-list" id="tg-link-list" role="group" aria-label="Séries da biblioteca"><p class="hint">carregando…</p></div>
      <div class="tg-link-episode">
        <label>Temporada <input class="input" id="tg-link-s" type="number" min="0" max="999" inputmode="numeric" value="${opts.current?.seasonNumber ?? 1}" /></label>
        <label>Episódio <input class="input" id="tg-link-e" type="number" min="1" max="9999" inputmode="numeric" value="${opts.current?.episodeNumber ?? 1}" /></label>
      </div>
      <p class="hint tg-link-error" id="tg-link-error" role="alert"></p>
      <div class="tg-link-actions">
        <button class="btn btn-primary" id="tg-link-save" type="button" disabled>Vincular</button>
        ${opts.current ? '<button class="btn btn-ghost" id="tg-link-clear" type="button">Sem vínculo</button>' : ''}
        <button class="btn btn-ghost" id="tg-link-cancel" type="button">Cancelar</button>
      </div>
    </form>`;

  const q = dialog.querySelector('#tg-link-q') as HTMLInputElement;
  const list = dialog.querySelector('#tg-link-list') as HTMLElement;
  const season = dialog.querySelector('#tg-link-s') as HTMLInputElement;
  const episode = dialog.querySelector('#tg-link-e') as HTMLInputElement;
  const error = dialog.querySelector('#tg-link-error') as HTMLElement;
  const save = dialog.querySelector('#tg-link-save') as HTMLButtonElement;
  let series: LibraryItemDto[] = [];
  let selected: string | null = opts.current?.titleId ?? null;

  const renderList = () => {
    const words = normalizeSearch(q.value).split(' ').filter(Boolean);
    const matches = series.filter((it) => words.every((w) => normalizeSearch(it.title.title).includes(w)));
    list.innerHTML = matches.length
      ? matches.map((it) => option(it, selected)).join('')
      : series.length === 0
        ? '<p class="hint">Nenhuma série na sua biblioteca ainda. Adicione a série primeiro.</p>'
        : '<p class="hint">Nenhuma série com esse nome na biblioteca.</p>';
    save.disabled = !selected;
  };

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if (!btn?.dataset.id) return;
    selected = btn.dataset.id;
    renderList();
    list.querySelector<HTMLButtonElement>(`button[data-id="${CSS.escape(selected)}"]`)?.focus();
  });
  q.addEventListener('input', renderList);

  const fail = (message: string) => {
    error.textContent = message;
    save.disabled = !selected;
  };

  save.addEventListener('click', () => {
    const seasonNumber = Number(season.value);
    const episodeNumber = Number(episode.value);
    if (season.value.trim() === '' || episode.value.trim() === '' || !selected || !Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
      fail('Informe a temporada (0 a 999) e o episódio (1 a 9999).');
      return;
    }
    save.disabled = true;
    error.textContent = '';
    linkTelegramItem(opts.channelId, opts.messageId, { titleId: selected, seasonNumber, episodeNumber })
      .then(() => {
        dialog.close();
        opts.onDone();
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : 'não foi possível vincular agora'));
  });

  dialog.querySelector('#tg-link-clear')?.addEventListener('click', () => {
    unlinkTelegramItem(opts.channelId, opts.messageId)
      .then(() => {
        dialog.close();
        opts.onDone();
      })
      .catch(() => showToast('não foi possível remover o vínculo agora'));
  });
  dialog.querySelector('#tg-link-cancel')?.addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    dialog.remove();
    trigger?.focus();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  q.focus();

  listLibrary()
    .then((res) => {
      series = res.items.filter((it) => it.title.mediaType === 'tv');
      renderList();
    })
    .catch(() => {
      list.innerHTML = '<p class="hint">não foi possível carregar a biblioteca agora</p>';
    });
};
