import { compareTmdbTv, type SourceCompareDto } from '../api/index.ts';
import { escapeHtml } from '../ui/card.ts';

/** Tabela TMDB x TVmaze. Divergências em destaque; sem correspondência segura, diz isso em vez de chutar. */
export const compareHtml = (d: SourceCompareDto): string => {
  if (!d.match) return '<p class="sc-note">Não achei esta série na TVmaze com segurança (nome e ano precisam bater).</p>';
  const diffs = d.rows.filter((r) => r.differs).length;
  const rows = d.rows
    .map((r) => `<tr class="${r.differs ? 'is-diff' : ''}"><th scope="row">${escapeHtml(r.label)}</th><td>${escapeHtml(r.tmdb)}</td><td>${escapeHtml(r.tvmaze)}</td></tr>`)
    .join('');
  return `<table class="sc-table"><thead><tr><th></th><th>TMDB</th><th>TVmaze</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="sc-note">${diffs === 0 ? 'As duas fontes concordam.' : `${diffs} ${diffs === 1 ? 'divergência' : 'divergências'} em destaque.`} <a href="#/title/tvmaze/tv/${escapeHtml(d.match.id)}">Abrir na TVmaze</a></p>`;
};

/** Botão sob demanda: a comparação faz uma busca extra na TVmaze, então só roda quando a pessoa pede. */
export const renderSourceCompare = (host: HTMLElement, tmdbId: string): void => {
  host.innerHTML = '<button class="btn btn-ghost btn-sm" type="button">Comparar com a TVmaze</button>';
  const btn = host.querySelector('button') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Comparando…';
    compareTmdbTv(tmdbId)
      .then((d) => {
        host.innerHTML = compareHtml(d);
      })
      .catch(() => {
        btn.disabled = false;
        btn.textContent = 'Não deu certo. Tentar de novo';
      });
  });
};
