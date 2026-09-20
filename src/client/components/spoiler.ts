import { escapeHtml } from './card.ts';
import { getShowSpoilers } from '../state.ts';

export const renderSpoilerText = (text: string, className = ''): HTMLElement => {
  const box = document.createElement('div');
  box.className = `spoiler-box ${className}`.trim();
  const hidden = !getShowSpoilers();
  if (hidden) box.classList.add('hidden');

  box.innerHTML = `
    <div class="content">${escapeHtml(text)}</div>
    <div class="reveal">👁️ toque para revelar</div>
  `;

  box.addEventListener('click', () => box.classList.toggle('hidden'));
  return box;
};
