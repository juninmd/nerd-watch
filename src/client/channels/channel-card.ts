import type { TelegramItemDto } from '../api/index.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { formatDuration } from '../ui/time-format.ts';
import { itemDescription, itemFileName, itemTitle, uploadDate } from './telegram-items.ts';

/** Miolo do card de vídeo (grade e lista): miniatura com selos + título, nome do arquivo e data de upload. */
export const videoCardHtml = (item: TelegramItemDto, resumeAt: number | null, watched: boolean): string => {
  const fileName = itemFileName(item);
  const posted = uploadDate(item.postedAt);
  const description = itemDescription(item);
  return `
    <div class="poster${item.thumbnailUrl ? '' : ' placeholder'}">
      ${item.thumbnailUrl ? '' : `<span class="initials">${icon('film')}</span>`}
      <span class="poster-play" aria-hidden="true">${icon('play')}</span>
      ${item.durationSeconds ? `<span class="badge badge-corner">${formatDuration(item.durationSeconds)}</span>` : ''}
      ${resumeAt !== null ? `<span class="badge badge-watching resume-badge">continuar ${formatDuration(resumeAt)}</span>` : ''}
      ${watched ? `<span class="badge badge-watched resume-badge">assistido</span>` : ''}
    </div>
    <div class="meta">
      <div class="title">${escapeHtml(itemTitle(item))}</div>
      ${description ? `<p class="tg-card-desc">${escapeHtml(description)}</p>` : ''}
      ${fileName || posted ? `<dl class="tg-facts">
        ${fileName ? `<div class="tg-fact tg-file" title="${escapeHtml(fileName)}">${icon('film', 'sm')}<dt class="sr-only">Arquivo</dt><dd>${escapeHtml(fileName)}</dd></div>` : ''}
        ${posted ? `<div class="tg-fact">${icon('calendar', 'sm')}<dt class="sr-only">Enviado em</dt><dd><time datetime="${posted.iso}">${escapeHtml(posted.label)}</time></dd></div>` : ''}
      </dl>` : ''}
    </div>`;
};

/** Esqueleto da grade/lista enquanto o canal carrega. */
export const channelSkeletonHtml = (): string =>
  `<div class="skeleton tg-skel-hero"></div><div class="tg-grid" aria-busy="true" aria-label="carregando vídeos">${'<div class="skeleton tg-skel-card"></div>'.repeat(8)}</div>`;
