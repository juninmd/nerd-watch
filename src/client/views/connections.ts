import { exportBackup, health, importBackup, type HealthResponse } from '../api.ts';
import { renderDriveConnect } from '../components/drive-connect.ts';
import { renderSourceCard } from '../components/source-card.ts';
import { renderTelegramLogin } from '../components/telegram-login.ts';
import { mountTraktActions } from '../components/trakt-actions.ts';
import { listSources } from '../source-api.ts';
import { icon, type IconName } from '../icons.ts';
import { showToast } from '../state.ts';

interface Integration {
  title: string;
  icon: IconName;
  on: boolean;
  onText: string;
  offText: string;
}

const integrations = (h: HealthResponse): Integration[] => [
  {
    title: 'Catálogo TMDB',
    icon: 'film',
    on: h.tmdbEnabled,
    onText: 'Busca de filmes, séries e novelas ativa.',
    offText: 'Defina TMDB_API_KEY no .env (chave grátis em themoviedb.org) para buscar filmes e séries. Domínio público e sua lista funcionam sem ela.',
  },
  {
    title: 'Legendas (OpenSubtitles)',
    icon: 'list',
    on: h.openSubtitlesEnabled,
    onText: 'Legendas do OpenSubtitles ativas.',
    offText: 'Opcional: defina OPENSUBTITLES_API_KEY no .env. Sem ela, as legendas vêm dos addons públicos do Stremio.',
  },
  {
    title: 'Streaming P2P',
    icon: 'play',
    on: h.torrentEnabled,
    onText: 'Reprodução do acervo de domínio público via torrent ativa.',
    offText: 'Desligado neste servidor (TORRENT_ENABLED).',
  },
];

const statusCard = (i: Integration): string => `
  <section class="conn-card">
    <div class="conn-head">
      <span class="conn-ic">${icon(i.icon)}</span>
      <div><h2>${i.title}</h2><p>${i.on ? i.onText : i.offText}</p></div>
      <span class="chip-status ${i.on ? 'ok' : 'off'}"><span class="led${i.on ? '' : ' off'}"></span>${i.on ? 'ativo' : 'desligado'}</span>
    </div>
  </section>`;

const bindBackup = (root: HTMLElement): void => {
  (root.querySelector('#btn-export') as HTMLButtonElement).addEventListener('click', async () => {
    try {
      const data = await exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `nerd-watch-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('backup exportado');
    } catch {
      showToast('falha ao exportar backup');
    }
  });

  const input = root.querySelector('#import-file') as HTMLInputElement;
  (root.querySelector('#btn-import') as HTMLButtonElement).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const res = await importBackup(JSON.parse(await file.text()));
      showToast(`backup importado: ${res.imported.titles} títulos, ${res.imported.libraryEntries} na lista`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao importar backup');
    }
  });
};

/** Central de conexões: status de cada integração, login guiado do Telegram e backup. */
export const renderConnections = (host: HTMLElement, query: URLSearchParams): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Conexões</h1>
      <p class="view-subtitle">Tudo que o app usa de fora, num lugar só: o que está ligado, o que falta e como resolver.</p>
    </header>
    <div class="conn-grid">
      <section class="conn-card conn-wide" id="conn-telegram"></section>
      <section class="conn-card conn-wide" id="conn-drive"></section>
      <div id="conn-sources" class="conn-stack"></div>
      <div id="conn-status" class="conn-stack"></div>
      <section class="conn-card" id="conn-backup" tabindex="-1">
        <div class="conn-head">
          <span class="conn-ic">${icon('download')}</span>
          <div><h2>Backup</h2><p>Sua lista, notas e canais num arquivo JSON. Tudo fica neste computador (data/nerd-watch.db).</p></div>
        </div>
        <div class="conn-actions">
          <button class="btn btn-ghost" id="btn-export" type="button">${icon('download', 'sm')} Exportar backup</button>
          <button class="btn btn-ghost" id="btn-import" type="button">${icon('upload', 'sm')} Importar backup</button>
          <input type="file" accept="application/json" id="import-file" hidden />
        </div>
      </section>
    </div>
  `;

  renderTelegramLogin(host.querySelector('#conn-telegram') as HTMLElement);

  // Uma fonte de vídeo = um cartão desenhado a partir do descritor do servidor (campos, passo a passo, OAuth).
  const sourcesEl = host.querySelector('#conn-sources') as HTMLElement;
  listSources()
    .then((sources) => {
      for (const s of sources.filter((x) => !x.ownCard)) {
        const card = document.createElement('section');
        card.className = 'conn-card';
        card.id = `conn-${s.id}`;
        sourcesEl.appendChild(card);
        if (s.id !== 'trakt') {
          renderSourceCard(card, s);
          continue;
        }
        // Trakt tem ações além da conexão (importar/exportar): ficam num bloco abaixo do cartão genérico.
        const actions = document.createElement('div');
        sourcesEl.appendChild(actions);
        renderSourceCard(card, s, () => void mountTraktActions(actions));
        void mountTraktActions(actions);
      }
    })
    .catch(() => {
      sourcesEl.innerHTML = '<p class="hint">não foi possível listar as fontes de vídeo</p>';
    });
  renderDriveConnect(host.querySelector('#conn-drive') as HTMLElement);
  bindBackup(host.querySelector('#conn-backup') as HTMLElement);

  const statusEl = host.querySelector('#conn-status') as HTMLElement;
  health()
    .then((h) => {
      statusEl.innerHTML = integrations(h).map(statusCard).join('');
    })
    .catch(() => {
      statusEl.innerHTML = '<p class="hint">não foi possível consultar o estado do servidor</p>';
    });

  // Atalho da paleta ("Exportar backup"): leva o foco ao cartão em vez de só rolar a página.
  if (query.get('focus') === 'backup') (host.querySelector('#conn-backup') as HTMLElement).focus();
};
