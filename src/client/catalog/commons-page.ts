import { type CommonsVideoDto, getCommonsVideo } from '../api/index.ts';
import { renderInlinePlayer } from '../player/inline-player.ts';
import { parkPlayer } from '../player/player-dock.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';

const paint = (host: HTMLElement, v: CommonsVideoDto): void => {
  host.innerHTML = `
    <header class="view-head">
      ${backButtonHtml()}
      <h1 class="view-title">${escapeHtml(v.name)}</h1>
      <p class="view-subtitle"><span class="badge badge-archive">${escapeHtml(v.license)}</span> Wikimedia Commons${v.author ? ` · ${escapeHtml(v.author)}` : ''}</p>
    </header>
    <div class="detail-grid">
      <div>
        <div id="commons-player"></div>
        <p class="hint" id="commons-note"></p>
        <p>${escapeHtml(v.description || 'Sem descrição disponível.')}</p>
      </div>
      <div>
        <div class="side-card">
          <h3>Licença e origem</h3>
          <p>${v.licenseUrl ? `<a href="${escapeHtml(v.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.license)}</a>` : escapeHtml(v.license)}</p>
          <a class="btn btn-ghost btn-sm" href="${escapeHtml(v.pageUrl)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center;margin-bottom:8px">${icon('forward', 'sm')} página no Commons</a>
          <a class="btn btn-ghost btn-sm" href="${escapeHtml(v.videoUrl)}" target="_blank" rel="noopener noreferrer" download style="width:100%;justify-content:center">${icon('download', 'sm')} baixar o arquivo</a>
        </div>
      </div>
    </div>`;
  wireBackButton(host, '/public-domain');
  const note = host.querySelector('#commons-note') as HTMLElement;
  (host.querySelector('#commons-player') as HTMLElement).appendChild(
    renderInlinePlayer({
      item: {
        key: `commons:${v.title}`,
        src: v.videoUrl,
        title: v.name,
        subtitle: 'Wikimedia Commons',
        poster: v.thumbnailUrl,
        channelId: 'commons',
        messageId: v.title,
        durationSeconds: null,
        route: `/commons/${encodeURIComponent(v.title)}`,
        captions: { query: v.name },
      },
      minimizable: true,
      onUnsupported: () => {
        note.textContent = 'O navegador não tocou este formato (comum em .ogv); use "baixar o arquivo" ou abra no Commons.';
      },
    }),
  );
};

export const renderCommonsVideo = (host: HTMLElement, title: string): void => {
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = `${backButtonHtml()}<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  wireBackButton(root, '/public-domain');
  parkPlayer();
  getCommonsVideo(title)
    .then((v) => {
      if (!root.isConnected) return;
      paint(root, v);
    })
    .catch(() => {
      if (!root.isConnected) return;
      root.innerHTML = `${backButtonHtml()}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>vídeo indisponível no Commons agora</div>`;
      wireBackButton(root, '/public-domain');
    });
};
