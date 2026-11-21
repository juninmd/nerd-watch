import { escapeHtml, posterStyleAttr } from '../ui/card.ts';
import { clearContinueWatching, continueWatching, removeFromContinueWatching } from './player-dock.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from '../app/router.ts';
import { canShareAppLink, copyAppLink } from '../app/share-link.ts';
import { watchPath } from '../channels/telegram-items.ts';
import { mediaUrl } from '../platform/tauri.ts';
import { formatDuration } from '../ui/time-format.ts';

const MAX_CARDS = 12;

/** Cards dos vídeos dos canais que o usuário começou e não terminou (posição salva neste navegador). */
export const continueWatchingCards = (): HTMLElement[] =>
  continueWatching(MAX_CARDS).map(({ key, meta, position, resumeAt }) => {
    const total = position.duration && position.duration > 0 ? position.duration : null;
    const percent = total ? Math.min(100, Math.round((resumeAt / total) * 100)) : 0;
    const left = total ? formatDuration(Math.max(0, Math.round(total - resumeAt))) : null;
    const card = document.createElement('div');
    card.className = 'resume-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `continuar ${meta.title} de ${formatDuration(resumeAt)}`);
    card.innerHTML = `
      <div class="resume-thumb${meta.poster ? '' : ' placeholder'}"${meta.poster ? posterStyleAttr(mediaUrl(meta.poster)) : ''}>
        ${meta.poster ? '' : icon('film')}
        <span class="resume-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></span>
      </div>
      <button class="resume-remove" type="button" aria-label="${escapeHtml(`remover ${meta.title} de continuar assistindo`)}" title="Remover de continuar assistindo">${icon('x', 'sm')}</button>
      ${canShareAppLink() ? `<button class="resume-link" type="button" aria-label="${escapeHtml(`copiar link para continuar ${meta.title}`)}" title="Copiar link para continuar">${icon('link', 'sm')}</button>` : ''}
      <div class="resume-text"><b>${escapeHtml(meta.title)}</b><small>${escapeHtml(meta.subtitle)} · ${left ? `faltam ${left}` : `parou em ${formatDuration(resumeAt)}`}</small></div>`;
    const go = () => navigate(meta.route ?? watchPath(meta.channelId, meta.messageId));
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.target === card && e.key === 'Enter') go();
    });
    card.querySelector('.resume-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromContinueWatching(key);
      card.remove();
    });
    card.querySelector('.resume-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      copyAppLink(meta.route ?? watchPath(meta.channelId, meta.messageId), { at: resumeAt, label: 'Link para continuar' });
    });
    return card;
  });

/** Troca só os cards de "continuar" de um trilho (ex.: a sincronização trouxe posições novas), sem mexer no resto. */
export const refreshResumeCards = (rail: HTMLElement): void => {
  for (const old of rail.querySelectorAll('.resume-card')) old.remove();
  const cards = continueWatchingCards();
  if (cards.length) rail.querySelector('.empty-state')?.remove();
  rail.prepend(...cards);
};

/** Confirma e apaga todas as posições em andamento; devolve quantas saíram (0 se cancelou). */
export const confirmClearContinueWatching = (): number => {
  if (!confirm('Limpar tudo de "Continuar assistindo"? Só o progresso some; os vídeos continuam nos canais e na biblioteca.')) return 0;
  return clearContinueWatching();
};
