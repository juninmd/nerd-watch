import { getArchiveTitle } from '../api.ts';
import { renderInlinePlayer } from '../components/inline-player.ts';
import { parkPlayer, stopIfOnPage } from '../components/player-dock.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { renderSubtitlesPanel } from '../components/subtitles.ts';
import { renderTitleError } from '../components/title-error.ts';
import { renderTorrentPanel } from '../components/torrent-player.ts';
import { escapeHtml } from '../components/card.ts';
import { titlePath } from '../title-link.ts';

export const renderArchiveDetail = (host: HTMLElement, identifier: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    // Re-renderizar a página (ex.: mudar o status) destruiria o palco com o vídeo dentro; estaciona antes e o player retoma o mesmo vídeo.
    parkPlayer();
    getArchiveTitle(identifier)
      .then((d) => {
        host.innerHTML = `
          <div class="hero">
            <div class="backdrop" style="filter:blur(24px) brightness(0.5);transform:scale(1.1)"></div>
            <div class="scrim"></div>
            <div class="hero-content">
              <div class="hero-poster"></div>
              <div class="hero-info">
                <h1>${escapeHtml(d.title)}</h1>
                <div class="hero-meta">
                  <span class="badge badge-archive">domínio público</span>
                  ${d.year ? `<span>${d.year}</span>` : ''}
                  <span>Internet Archive</span>
                </div>
                <p class="hero-overview">${escapeHtml(d.overview || 'Sem sinopse disponível para este item.')}</p>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              <div class="section-head"><h2>▶️ Assistir agora, dentro do app</h2></div>
              <div id="main-player"></div>
              <p class="view-subtitle" style="margin-top:8px">
                Reprodução direta do Internet Archive — este título está em domínio público, sem custo e 100% legal.
                <span id="player-switch"></span>
              </p>
            </div>
            <div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div class="side-card">
                <h3>Baixar</h3>
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.torrentUrl)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center;margin-bottom:8px">
                  🧲 torrent oficial (Internet Archive)
                </a>
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.detailsUrl)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center">
                  🔗 página no archive.org
                </a>
              </div>
              <div class="side-card">
                <h3>Assistir por P2P</h3>
                ${
                  d.hasPlayableVideo === false
                    ? `<p class="hint">este item da Archive só tem formatos que o navegador não toca (OGV/AVI). Baixe pelo torrent ao lado para ver num player de vídeo.</p>`
                    : `<div id="torrent-panel"></div>`
                }
              </div>
              <div class="side-card">
                <h3>Legendas</h3>
                ${
                  d.subtitleUrl
                    ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(d.subtitleUrl)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center;margin-bottom:10px">⬇️ legenda hospedada na Archive.org</a>`
                    : ''
                }
                <div id="subtitles-panel"></div>
              </div>
            </div>
          </div>
        `;

        // Via propriedade CSSOM, não innerHTML: o navegador parseia isso como um único valor CSS,
        // então aspas/parênteses no identifier não conseguem fechar o url() e injetar outra declaração
        // (diferente de interpolar em `style="...url('${...}')"`, onde HTML é parseado antes do CSS).
        (host.querySelector('.backdrop') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;
        (host.querySelector('.hero-poster') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;

        // Player do app por padrão quando o item tem MP4/WebM; sem arquivo compatível (ou se o navegador não tocar), o embed da Archive.
        const playerHost = host.querySelector('#main-player') as HTMLElement;
        const switchHost = host.querySelector('#player-switch') as HTMLElement;
        const showEmbed = (reason: string) => {
          playerHost.innerHTML = `<div class="player-frame"><iframe src="${escapeHtml(d.embedUrl)}" allowfullscreen title="${escapeHtml(d.title)}"></iframe></div>`;
          switchHost.textContent = reason;
          // Escolha do usuário (sem erro): dá para voltar ao player do app.
          const src = d.directVideoUrl;
          if (src && !reason) {
            switchHost.innerHTML = '<button class="link-btn" id="use-app" type="button">Usar o player do app</button>';
            (switchHost.querySelector('#use-app') as HTMLButtonElement).addEventListener('click', () => showAppPlayer(src));
          }
        };
        const showAppPlayer = (src: string) => {
          playerHost.innerHTML = '';
          playerHost.appendChild(
            renderInlinePlayer({
              item: {
                key: `archive:${d.identifier}`,
                src,
                title: d.title,
                subtitle: 'Internet Archive',
                poster: d.posterUrl,
                channelId: 'archive',
                messageId: d.identifier,
                durationSeconds: null,
                route: titlePath('archive', '_', d.identifier),
              },
              minimizable: true,
              onUnsupported: () => {
                stopIfOnPage();
                showEmbed('O seu navegador não tocou este arquivo no player do app; usando o player da Archive.org.');
              },
            }),
          );
          switchHost.innerHTML = '<button class="link-btn" id="use-embed" type="button">Usar o player do Archive.org</button>';
          (switchHost.querySelector('#use-embed') as HTMLButtonElement).addEventListener('click', () => {
            stopIfOnPage();
            showEmbed('');
          });
        };
        if (d.directVideoUrl) showAppPlayer(d.directVideoUrl);
        else showEmbed('');

        const statusHost = host.querySelector('#status-actions') as HTMLElement;
        statusHost.appendChild(
          renderStatusActions({
            titleId: d.titleId,
            entryId: d.library?.id ?? null,
            watchStatus: d.library?.watch_status ?? null,
            rating: d.library?.rating ?? null,
            onChange: () => load(),
          }),
        );

        const subtitlesHost = host.querySelector('#subtitles-panel') as HTMLElement;
        subtitlesHost.appendChild(renderSubtitlesPanel({ query: `${d.title} ${d.year ?? ''}`.trim() }));

        const torrentHost = host.querySelector('#torrent-panel') as HTMLElement | null;
        torrentHost?.appendChild(renderTorrentPanel({ identifier: d.identifier, title: d.title, posterUrl: d.posterUrl }));
      })
      .catch(() => renderTitleError(host, load));
  };

  load();
};
