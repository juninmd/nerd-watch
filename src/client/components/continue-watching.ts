import { escapeHtml } from './card.ts';
import { continueWatching } from './player-dock.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';

const MAX_CARDS = 12;

/** Cards dos vídeos dos canais que o usuário começou e não terminou (posição salva neste navegador). */
export const continueWatchingCards = (): HTMLElement[] =>
  continueWatching(MAX_CARDS).map(({ meta, position, resumeAt }) => {
    const total = position.duration && position.duration > 0 ? position.duration : null;
    const percent = total ? Math.min(100, Math.round((resumeAt / total) * 100)) : 0;
    const left = total ? formatDuration(Math.max(0, Math.round(total - resumeAt))) : null;
    const card = document.createElement('div');
    card.className = 'resume-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `continuar ${meta.title} de ${formatDuration(resumeAt)}`);
    card.innerHTML = `
      <div class="resume-thumb${meta.poster ? '' : ' placeholder'}"${meta.poster ? ` style="background-image:url('${escapeHtml(meta.poster)}')"` : ''}>
        ${meta.poster ? '' : icon('film')}
        <span class="resume-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></span>
      </div>
      <div class="resume-text"><b>${escapeHtml(meta.title)}</b><small>${escapeHtml(meta.subtitle)} · ${left ? `faltam ${left}` : `parou em ${formatDuration(resumeAt)}`}</small></div>`;
    const go = () => navigate(meta.route ?? watchPath(meta.channelId, meta.messageId));
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    return card;
  });
