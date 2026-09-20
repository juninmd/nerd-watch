import { addTelegramChannel, listTelegramChannels, type TelegramChannelDto, type TelegramChannelMode } from '../api.ts';
import { renderCard } from '../components/card.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';

const MODE_LABEL: Record<TelegramChannelMode, string> = { public: 'público', personal: 'conta pessoal', bot: 'bot' };

export const renderTelegramChannels = (host: HTMLElement): void => {
  host.innerHTML = `
    <h1 class="view-title">✈️ Canais do Telegram</h1>
    <p class="view-subtitle">
      Adicione um canal público pelo @usuário pra maratonar os vídeos dentro do app. Modo bot exige um token
      grátis do @BotFather no .env e só vê vídeos postados a partir de agora (sem histórico); modo conta
      pessoal exige rodar <code>bun run telegram:login</code> uma vez, mas é o único com histórico completo
      do canal e sem limite de tamanho de arquivo.
    </p>
    <form id="add-form" class="chip-row" style="margin-bottom:20px;gap:10px">
      <input type="text" id="handle-input" placeholder="@usuario_do_canal" autocomplete="off"
        style="flex:1;min-width:220px;padding:9px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
      <select id="mode-input" style="padding:9px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
        <option value="public">canal público (sem login)</option>
        <option value="bot">bot (precisa de TELEGRAM_BOT_TOKEN)</option>
        <option value="personal">conta pessoal (histórico completo)</option>
      </select>
      <button class="btn btn-primary btn-sm" type="submit">adicionar</button>
    </form>
    <div id="tg-grid"><div class="grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  const grid = host.querySelector('#tg-grid') as HTMLElement;
  const form = host.querySelector('#add-form') as HTMLFormElement;
  const handleInput = host.querySelector('#handle-input') as HTMLInputElement;
  const modeInput = host.querySelector('#mode-input') as HTMLSelectElement;

  const renderChannels = (channels: TelegramChannelDto[]) => {
    if (channels.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="big">✈️</div>nenhum canal adicionado ainda</div>`;
      return;
    }
    const g = document.createElement('div');
    g.className = 'grid';
    for (const ch of channels) {
      g.appendChild(
        renderCard({
          title: ch.title,
          posterUrl: ch.posterUrl,
          meta: `${MODE_LABEL[ch.mode]} · ${ch.itemCount} vídeo${ch.itemCount === 1 ? '' : 's'}`,
          onClick: () => navigate(`/telegram/${ch.titleId}`),
        }),
      );
    }
    grid.innerHTML = '';
    grid.appendChild(g);
  };

  const load = () => {
    listTelegramChannels()
      .then((data) => renderChannels(data.channels))
      .catch(() => {
        grid.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar os canais</div>`;
      });
  };

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
};
