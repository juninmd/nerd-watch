import {
  acceptTelegramSuggestions,
  deleteTelegramChannel,
  getTelegramChannel,
  loadMoreTelegramHistory,
  refreshTelegramChannel,
  refreshTelegramLinks,
  searchTelegramHistory,
  type TelegramChannelDetailDto,
} from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { linkBadge, openLinkDialog } from '../components/telegram-link.ts';
import { getQueueOrder, type QueueOrder, savedPosition, setQueueOrder } from '../components/player-dock.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { icon } from '../icons.ts';
import { resumePoint } from '../playback-store.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { canRefreshMode, handleLabel, MODE_INFO } from '../source-modes.ts';
import { filterItems, itemTitle, orderItems, watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';

/** Quantos cards aparecem de cada vez: milhares de vídeos carregados não viram milhares de nós no DOM. */
const PAGE_SIZE = 60;

/** Estado da lista que precisa sobreviver a um `reload()` (carregar mais antigos, buscar no Telegram…). */
interface ListState {
  q: string;
  shown: number;
}

export const renderTelegramChannel = (host: HTMLElement, titleId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  const ui: ListState = { q: '', shown: PAGE_SIZE };

  const load = () => {
    // Recalcula o vínculo automático com a biblioteca atual antes de mostrar a lista (idempotente, sem falhar a tela).
    refreshTelegramLinks(titleId)
      .catch(() => undefined)
      .then(() => getTelegramChannel(titleId, { fillThumbs: true }))
      .then((d) => renderDetail(host, d, load, ui))
      .catch(() => {
        host.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar esse canal</div>`;
      });
  };

  load();
};

const renderDetail = (host: HTMLElement, d: TelegramChannelDetailDto, reload: () => void, ui: ListState): void => {
  const order = getQueueOrder();
  const items = orderItems(d.items, order);
  host.innerHTML = `
    <div class="hero">
      <div class="backdrop${d.posterUrl ? '' : ' placeholder'}"${d.posterUrl ? ` style="background-image:url('${escapeHtml(d.posterUrl)}')"` : ''}></div>
      <div class="scrim"></div>
      <div class="hero-content">
        ${d.posterUrl ? `<div class="hero-avatar" style="background-image:url('${escapeHtml(d.posterUrl)}')" role="img" aria-label="foto de ${escapeHtml(d.title)}"></div>` : ''}
        <div class="hero-info">
          <h1>${escapeHtml(d.title)}</h1>
          <div class="hero-meta">
            <span class="badge badge-archive">${MODE_INFO[d.mode].badge}</span>
            <span>${d.itemCount} vídeo${d.itemCount === 1 ? '' : 's'}</span>
            ${d.link ? `<a class="tg-link" href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.link.replace('https://', ''))}</a>` : ''}
          </div>
          ${d.description ? `<p class="hero-overview tg-description">${escapeHtml(d.description)}</p>` : ''}
          ${d.items.length ? `<div class="hero-actions"><button class="btn btn-primary" id="tg-play-all" type="button">${icon('play', 'sm')} Reproduzir tudo</button>${d.link ? `<a class="btn btn-ghost" href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">${MODE_INFO[d.mode].open}</a>` : ''}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="section-head"><h2>Vídeos</h2>${d.items.length > 1 ? `<select class="select" id="tg-order" aria-label="Ordem dos vídeos"><option value="newest"${order === 'newest' ? ' selected' : ''}>Mais recentes primeiro</option><option value="oldest"${order === 'oldest' ? ' selected' : ''}>Mais antigos primeiro</option></select>` : ''}${canRefreshMode(d.mode) ? `<button class="btn btn-ghost btn-sm" id="tg-refresh" type="button">${icon('download', 'sm')} atualizar</button>` : ''}</div>
        ${d.mode === 'bot' ? `<p class="hint">modo bot só recebe vídeos postados a partir de agora — sem histórico retroativo.</p>` : ''}
        ${d.items.some((i) => i.link?.status === 'suggested') ? `<div class="tg-links-bar" role="region" aria-label="Sugestões de vínculo"><span>${d.items.filter((i) => i.link?.status === 'suggested').length} sugestão(ões) de vínculo para confirmar</span><button class="btn btn-ghost btn-sm" id="tg-accept" type="button">aceitar sugestões</button></div>` : ''}
        <div class="tg-search">
          <input type="search" class="input input-pill" id="tg-q" placeholder="buscar no título e na descrição dos vídeos" autocomplete="off" aria-label="Buscar nos vídeos deste canal" value="${escapeHtml(ui.q)}" />
          <span class="hint" id="tg-count" role="status" aria-live="polite"></span>
        </div>
        <div id="tg-items" class="grid"></div>
        <div id="tg-empty"></div>
        <div id="tg-more" class="tg-more"></div>
      </div>
      <div>
        <div class="side-card">
          <h3>Sua lista</h3>
          <div id="status-actions"></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="tg-delete" style="width:100%;justify-content:center;margin-top:12px;color:var(--danger)">${icon('trash', 'sm')} remover canal</button>
      </div>
    </div>
  `;

  const statusHost = host.querySelector('#status-actions') as HTMLElement;
  statusHost.appendChild(
    renderStatusActions({
      titleId: d.titleId,
      entryId: d.library?.id ?? null,
      watchStatus: d.library?.watch_status ?? null,
      rating: d.library?.rating ?? null,
      rewatchCount: d.library?.rewatch_count ?? 0,
      onChange: () => reload(),
    }),
  );

  const itemsHost = host.querySelector('#tg-items') as HTMLElement;
  const emptyHost = host.querySelector('#tg-empty') as HTMLElement;
  const moreHost = host.querySelector('#tg-more') as HTMLElement;
  const countEl = host.querySelector('#tg-count') as HTMLElement;
  const searchInput = host.querySelector('#tg-q') as HTMLInputElement;
  const remote = d.mode === 'personal' || d.mode === 'public';

  // Lista na ordem escolhida e já filtrada pela busca: "Reproduzir tudo" e o clique no card usam esta mesma lista.
  let current: typeof items = [];
  // O vídeo abre na tela de reprodução, com os próximos do canal ao lado; o player fixo só vem de "Minimizar".
  const play = (from: number) => {
    const item = current[from];
    if (item) navigate(watchPath(d.titleId, item.messageId));
  };

  /** Botão de rodapé que roda uma ação demorada (fala com o Telegram) com feedback e sem clique duplo. */
  const action = (label: string, run: () => Promise<string>): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'carregando do Telegram…';
      run()
        .then((message) => {
          showToast(message);
          reload();
        })
        .catch((err) => {
          showToast(err instanceof Error ? err.message : 'não foi possível falar com o Telegram agora');
          btn.disabled = false;
          btn.textContent = label;
        });
    });
    return btn;
  };

  const renderFooter = (matches: number, visible: number) => {
    moreHost.replaceChildren();
    if (matches > visible) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-ghost';
      more.textContent = `mostrar mais (${matches - visible})`;
      more.addEventListener('click', () => {
        ui.shown += PAGE_SIZE;
        renderItems();
      });
      moreHost.appendChild(more);
      return;
    }
    if (!remote) return;
    const query = ui.q.trim();
    if (query) {
      moreHost.appendChild(
        action(`buscar “${query}” no Telegram`, async () => {
          const res = await searchTelegramHistory(d.titleId, query);
          ui.shown += res.added;
          return res.found === 0 ? 'o Telegram não achou nenhum vídeo com esse texto' : `${res.found} vídeo(s) achado(s), ${res.added} novo(s) na lista`;
        }),
      );
    } else if (d.canLoadMore) {
      moreHost.appendChild(
        action('carregar vídeos mais antigos', async () => {
          const res = await loadMoreTelegramHistory(d.titleId);
          ui.shown += res.added;
          return res.exhausted ? `${res.added} vídeo(s) a mais — esse é o começo do histórico` : `${res.added} vídeo(s) mais antigos carregados`;
        }),
      );
    } else if (d.items.length > 0) {
      moreHost.innerHTML = `<p class="hint">fim do histórico: todos os vídeos desse canal já estão aqui.</p>`;
    }
  };

  const renderItems = () => {
    const matches = filterItems(orderItems(d.items, order), ui.q);
    current = matches;
    const visible = matches.slice(0, ui.shown);
    itemsHost.replaceChildren();

    const plural = d.items.length === 1 ? '' : 's';
    countEl.textContent = ui.q.trim()
      ? `${matches.length} de ${d.items.length} vídeo${plural} carregado${plural}`
      : d.items.length > visible.length
        ? `mostrando ${visible.length} de ${d.items.length}`
        : '';

    if (d.items.length === 0) {
      const emptyMessage =
        d.mode === 'bot'
          ? 'nenhum vídeo ainda — o bot precisa estar adicionado como admin do canal, e só grava o que for postado a partir de agora'
          : 'nenhum vídeo encontrado nesse canal ainda';
      emptyHost.innerHTML = `<div class="empty-state"><div class="big">${icon('inbox')}</div>${emptyMessage}</div>`;
    } else if (matches.length === 0) {
      emptyHost.innerHTML = `<div class="empty-state"><div class="big">🔎</div>nenhum vídeo com “${escapeHtml(ui.q.trim())}” entre os ${d.items.length} carregados${remote ? '<br /><small>use o botão abaixo para procurar no canal inteiro</small>' : ''}</div>`;
    } else {
      emptyHost.replaceChildren();
    }

    for (const [i, item] of visible.entries()) {
      const saved = savedPosition(`${d.titleId}:${item.messageId}`);
      const resumeAt = resumePoint(saved);
      const watched = saved?.done === true;
      const card = document.createElement('div');
      card.className = 'card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `reproduzir: ${itemTitle(item, 60)}${resumeAt !== null ? ` (continuar de ${formatDuration(resumeAt)})` : ''}`);
      card.innerHTML = `
        <div class="poster${item.thumbnailUrl ? '' : ' placeholder'}"${item.thumbnailUrl ? ` style="background-image:url('${escapeHtml(item.thumbnailUrl)}')"` : ''}>
          ${item.thumbnailUrl ? '' : `<span class="initials">${icon('film')}</span>`}
          ${item.durationSeconds ? `<span class="badge badge-corner">${formatDuration(item.durationSeconds)}</span>` : ''}
          ${resumeAt !== null ? `<span class="badge badge-watching resume-badge">continuar ${formatDuration(resumeAt)}</span>` : ''}
          ${watched ? `<span class="badge badge-watched resume-badge">assistido</span>` : ''}
        </div>
        <div class="meta">
          <div class="title">${escapeHtml(itemTitle(item, 60))}</div>
          ${item.postedAt ? `<div class="sub">${new Date(item.postedAt).toLocaleDateString('pt-BR')}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => play(i));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          play(i);
        }
      });
      // O botão de vínculo fica fora do card (que já é um botão de reprodução): nada de controle dentro de controle.
      const wrap = document.createElement('div');
      wrap.className = 'tg-item';
      wrap.appendChild(card);
      const linkRow = document.createElement('div');
      linkRow.className = 'tg-item-link';
      linkRow.innerHTML = `${linkBadge(item.link ?? null)}<button class="btn btn-ghost btn-sm" type="button" aria-label="${escapeHtml(`vincular “${itemTitle(item, 60)}” a um título`)}">${item.link ? 'alterar vínculo' : 'vincular a um título'}</button>`;
      linkRow.querySelector('button')?.addEventListener('click', () =>
        openLinkDialog({ channelId: d.titleId, messageId: item.messageId, current: item.link ?? null, onDone: () => reload() }),
      );
      wrap.appendChild(linkRow);
      itemsHost.appendChild(wrap);
    }
    renderFooter(matches.length, visible.length);
  };

  const applySearch = (text: string) => {
    ui.q = text;
    ui.shown = PAGE_SIZE;
    renderItems();
  };
  let typing: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener('input', () => {
    clearTimeout(typing);
    // A tela pode ter sido redesenhada (ordem, recarregar) antes dos 150 ms: o campo antigo não manda mais no estado.
    typing = setTimeout(() => {
      if (searchInput.isConnected) applySearch(searchInput.value);
    }, 150);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      applySearch('');
    }
  });

  host.querySelector('#tg-play-all')?.addEventListener('click', () => play(0));
  host.querySelector('#tg-accept')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    acceptTelegramSuggestions(d.titleId)
      .then((res) => {
        showToast(`${res.accepted} vínculo(s) confirmado(s)`);
        reload();
      })
      .catch(() => {
        showToast('não foi possível confirmar as sugestões agora');
        btn.disabled = false;
      });
  });
  host.querySelector('#tg-order')?.addEventListener('change', (e) => {
    setQueueOrder((e.target as HTMLSelectElement).value as QueueOrder);
    renderDetail(host, d, reload, ui);
  });
  renderItems();

  const deleteBtn = host.querySelector('#tg-delete') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`Remover ${handleLabel(d.handle, d.title)} do app? Os vídeos importados e o seu status somem (o canal no Telegram não é afetado).`)) return;
    deleteBtn.disabled = true;
    deleteTelegramChannel(d.titleId)
      .then(() => {
        showToast('canal removido');
        navigate('/telegram');
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'falha ao remover');
        deleteBtn.disabled = false;
      });
  });

  const refreshBtn = host.querySelector('#tg-refresh') as HTMLButtonElement | null;
  refreshBtn?.addEventListener('click', () => {
    refreshBtn.disabled = true;
    refreshTelegramChannel(d.titleId)
      .then((res) => {
        showToast(`canal atualizado — ${res.itemCount} vídeo(s)`);
        reload();
      })
      .catch(() => showToast('não foi possível atualizar agora'))
      .finally(() => {
        refreshBtn.disabled = false;
      });
  });
};
