import { deleteTelegramChannel, getTelegramChannel, refreshTelegramChannel, type TelegramChannelDetailDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { getQueueOrder, type QueueOrder, savedPosition, setQueueOrder } from '../components/player-dock.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { icon } from '../icons.ts';
import { resumePoint } from '../playback-store.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { itemTitle, orderItems, watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';

const MODE_LABEL: Record<TelegramChannelDetailDto['mode'], string> = {
  public: 'canal público',
  bot: 'bot',
  personal: 'conta pessoal',
};

export const renderTelegramChannel = (host: HTMLElement, titleId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getTelegramChannel(titleId)
      .then((d) => renderDetail(host, d, load))
      .catch(() => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar esse canal</div>`;
      });
  };

  load();
};

const renderDetail = (host: HTMLElement, d: TelegramChannelDetailDto, reload: () => void): void => {
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
            <span class="badge badge-archive">telegram · ${MODE_LABEL[d.mode]}</span>
            <span>${d.itemCount} vídeo${d.itemCount === 1 ? '' : 's'}</span>
            <a class="tg-link" href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.link.replace('https://', ''))}</a>
          </div>
          ${d.description ? `<p class="hero-overview tg-description">${escapeHtml(d.description)}</p>` : ''}
          ${d.items.length ? `<div class="hero-actions"><button class="btn btn-primary" id="tg-play-all" type="button">${icon('play', 'sm')} Reproduzir tudo</button><a class="btn btn-ghost" href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">Abrir no Telegram</a></div>` : ''}
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="section-head"><h2>Vídeos</h2>${d.items.length > 1 ? `<select class="select" id="tg-order" aria-label="Ordem dos vídeos"><option value="newest"${order === 'newest' ? ' selected' : ''}>Mais recentes primeiro</option><option value="oldest"${order === 'oldest' ? ' selected' : ''}>Mais antigos primeiro</option></select>` : ''}${d.mode === 'public' || d.mode === 'personal' ? `<button class="btn btn-ghost btn-sm" id="tg-refresh" type="button">${icon('download', 'sm')} atualizar</button>` : ''}</div>
        ${d.mode === 'bot' ? `<p class="hint">modo bot só recebe vídeos postados a partir de agora — sem histórico retroativo.</p>` : ''}
        <div id="tg-items" class="grid"></div>
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
      onChange: () => reload(),
    }),
  );

  const itemsHost = host.querySelector('#tg-items') as HTMLElement;
  // O vídeo abre na tela de reprodução, com os próximos do canal ao lado; o player fixo só vem de "Minimizar".
  const play = (from: number) => {
    const item = items[from];
    if (item) navigate(watchPath(d.titleId, item.messageId));
  };

  host.querySelector('#tg-play-all')?.addEventListener('click', () => play(0));
  host.querySelector('#tg-order')?.addEventListener('change', (e) => {
    setQueueOrder((e.target as HTMLSelectElement).value as QueueOrder);
    renderDetail(host, d, reload);
  });

  if (d.items.length === 0) {
    const emptyMessage =
      d.mode === 'bot'
        ? 'nenhum vídeo ainda — o bot precisa estar adicionado como admin do canal, e só grava o que for postado a partir de agora'
        : 'nenhum vídeo encontrado nesse canal ainda';
    itemsHost.outerHTML = `<div class="empty-state"><div class="big">📭</div>${emptyMessage}</div>`;
  } else {
    for (const [i, item] of items.entries()) {
      const resumeAt = resumePoint(savedPosition(`${d.titleId}:${item.messageId}`));
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
      itemsHost.appendChild(card);
    }
  }

  const deleteBtn = host.querySelector('#tg-delete') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`Remover @${d.handle} do app? Os vídeos importados e o seu status somem (o canal no Telegram não é afetado).`)) return;
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
