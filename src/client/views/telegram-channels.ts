import { addTelegramChannel, bulkDeleteTelegramChannels, listTelegramChannels, type TelegramChannelDto, type TelegramChannelMode } from '../api.ts';
import { renderCard } from '../components/card.ts';
import { openMyChannelsDialog } from '../components/telegram-my-channels.ts';
import { renderTelegramSettings } from '../components/telegram-settings.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';

const MODE_LABEL: Record<TelegramChannelMode, string> = { public: 'público', personal: 'conta pessoal', bot: 'bot' };

export const renderTelegramChannels = (host: HTMLElement, query?: URLSearchParams): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">✈️ Canais do Telegram</h1>
      <p class="view-subtitle">
        Adicione um canal pelo @usuário ou importe os canais da sua conta pessoal pra maratonar os vídeos aqui dentro.
        Modo bot exige um token grátis do @BotFather; modo conta pessoal exige um login único por QR code
        (veja "Configurar credenciais") e não tem limite de tamanho de arquivo. Hoje só os vídeos mais recentes
        de cada canal são importados.
      </p>
    </header>
    <form id="add-form" class="chip-row form-row">
      <input type="text" id="handle-input" class="input input-pill grow" placeholder="@usuario_do_canal" autocomplete="off" aria-label="@usuário do canal" />
      <select id="mode-input" class="select input-pill" aria-label="modo do canal">
        <option value="public">canal público (sem login)</option>
        <option value="bot">bot (precisa de TELEGRAM_BOT_TOKEN)</option>
        <option value="personal">conta pessoal (sem limite de tamanho)</option>
      </select>
      <button class="btn btn-primary btn-sm" type="submit">adicionar</button>
    </form>
    <details class="settings-details">
      <summary>⚙️ Configurar credenciais do Telegram</summary>
      <div id="tg-settings-host"></div>
    </details>
    <div class="toolbar" id="tg-toolbar">
      <button class="btn btn-ghost btn-sm" id="tg-my-channels" type="button">✈️ meus canais</button>
      <button class="btn btn-ghost btn-sm" id="tg-select-toggle" type="button" aria-pressed="false">☑️ selecionar</button>
      <span class="toolbar-selection" id="tg-selection" hidden>
        <span id="tg-sel-count" role="status"></span>
        <button class="btn btn-ghost btn-sm" id="tg-sel-all" type="button">todos</button>
        <button class="btn btn-danger btn-sm" id="tg-sel-delete" type="button" disabled>🗑️ remover</button>
      </span>
    </div>
    <div id="tg-grid"><div class="grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  renderTelegramSettings(host.querySelector('#tg-settings-host') as HTMLElement);

  const grid = host.querySelector('#tg-grid') as HTMLElement;
  const form = host.querySelector('#add-form') as HTMLFormElement;
  const handleInput = host.querySelector('#handle-input') as HTMLInputElement;
  const modeInput = host.querySelector('#mode-input') as HTMLSelectElement;
  const selectToggle = host.querySelector('#tg-select-toggle') as HTMLButtonElement;
  const selectionBar = host.querySelector('#tg-selection') as HTMLElement;
  const selCount = host.querySelector('#tg-sel-count') as HTMLElement;
  const selAll = host.querySelector('#tg-sel-all') as HTMLButtonElement;
  const selDelete = host.querySelector('#tg-sel-delete') as HTMLButtonElement;

  let channels: TelegramChannelDto[] = [];
  let selecting = false;
  const picked = new Set<string>();

  const syncSelectionBar = () => {
    selectToggle.setAttribute('aria-pressed', String(selecting));
    selectToggle.textContent = selecting ? '✕ cancelar seleção' : '☑️ selecionar';
    selectionBar.hidden = !selecting;
    selCount.textContent = `${picked.size} de ${channels.length} selecionado${picked.size === 1 ? '' : 's'}`;
    selAll.textContent = picked.size === channels.length ? 'nenhum' : 'todos';
    selDelete.disabled = picked.size === 0;
  };

  /** `focusIndex` devolve o foco ao card marcado — a grade é recriada e, sem isso, o teclado volta ao topo da página. */
  const renderChannels = (focusIndex?: number) => {
    syncSelectionBar();
    if (channels.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="big">✈️</div>nenhum canal adicionado ainda<br /><small>adicione um @usuário acima ou use "meus canais"</small></div>`;
      return;
    }
    const g = document.createElement('div');
    g.className = 'grid';
    for (const [index, ch] of channels.entries()) {
      g.appendChild(
        renderCard({
          title: ch.title,
          posterUrl: ch.posterUrl,
          meta: `${MODE_LABEL[ch.mode]} · ${ch.itemCount} vídeo${ch.itemCount === 1 ? '' : 's'}`,
          selection: selecting
            ? {
                selected: picked.has(ch.titleId),
                onToggle: () => {
                  if (!picked.delete(ch.titleId)) picked.add(ch.titleId);
                  renderChannels(index);
                },
              }
            : undefined,
          onClick: () => navigate(`/telegram/${ch.titleId}`),
        }),
      );
    }
    grid.innerHTML = '';
    grid.appendChild(g);
    if (focusIndex !== undefined) (g.children[focusIndex] as HTMLElement | undefined)?.focus();
  };

  const load = () => {
    listTelegramChannels()
      .then((data) => {
        channels = data.channels;
        for (const id of picked) if (!channels.some((c) => c.titleId === id)) picked.delete(id);
        renderChannels();
      })
      .catch(() => {
        grid.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar os canais</div>`;
      });
  };

  selectToggle.addEventListener('click', () => {
    selecting = !selecting;
    picked.clear();
    renderChannels();
  });

  selAll.addEventListener('click', () => {
    if (picked.size === channels.length) picked.clear();
    else for (const ch of channels) picked.add(ch.titleId);
    renderChannels();
  });

  selDelete.addEventListener('click', () => {
    const n = picked.size;
    if (!confirm(`Remover ${n} canal(is) do app? Os vídeos importados e o status deles somem (os canais no Telegram não são afetados).`)) return;
    selDelete.disabled = true;
    bulkDeleteTelegramChannels([...picked])
      .then((res) => {
        showToast(`${res.removed} canal(is) removido(s)`);
        picked.clear();
        selecting = false;
        load();
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'falha ao remover');
        selDelete.disabled = false;
      });
  });

  (host.querySelector('#tg-my-channels') as HTMLButtonElement).addEventListener('click', () => openMyChannelsDialog(load));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = handleInput.value.trim();
    const mode = modeInput.value as TelegramChannelMode;
    if (!handle) return;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      const channel = await addTelegramChannel(handle, mode);
      handleInput.value = '';
      showToast(`canal @${channel.handle} adicionado — ${channel.itemCount} vídeo(s)`);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao adicionar canal');
    } finally {
      submitBtn.disabled = false;
    }
  });

  load();

  // Atalho da paleta de comandos ("Importar meus canais"): abre o diálogo e limpa o parâmetro para não reabrir ao recarregar.
  if (query?.get('import') === '1') {
    history.replaceState(null, '', '#/telegram');
    openMyChannelsDialog(load);
  }
};
