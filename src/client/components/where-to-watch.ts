import { escapeHtml } from './card.ts';

export interface ProviderDto {
  name: string;
  logoUrl: string | null;
}

export interface WatchProviders {
  link: string | null;
  flatrate: ProviderDto[];
  rent: ProviderDto[];
  buy: ProviderDto[];
}

const GROUPS: Array<{ key: 'flatrate' | 'rent' | 'buy'; label: string }> = [
  { key: 'flatrate', label: 'Incluso na assinatura' },
  { key: 'rent', label: 'Alugar' },
  { key: 'buy', label: 'Comprar' },
];

const logo = (p: ProviderDto): string =>
  p.logoUrl
    ? `<div class="provider-logo" title="${escapeHtml(p.name)}"><img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.name)}" /></div>`
    : `<span class="provider-name">${escapeHtml(p.name)}</span>`;

/** Painel "Onde assistir": serviços agrupados pelo tipo de acesso; sem nenhum, explica em vez de ficar vazio. */
export const whereToWatchHtml = (providers: WatchProviders): string => {
  const groups = GROUPS.filter((g) => providers[g.key].length > 0);
  const body = groups.length
    ? groups
        .map((g) => `<div class="provider-group"><div class="hint">${g.label} (${providers[g.key].length})</div><div class="provider-row">${providers[g.key].map(logo).join('')}</div></div>`)
        .join('')
    : '<p class="hint">Nenhum streaming listado para a sua região.</p>';
  const link = providers.link
    ? `<a class="btn btn-primary btn-sm where-link" href="${escapeHtml(providers.link)}" target="_blank" rel="noopener noreferrer">ver todas as opções no TMDB</a>`
    : '';
  return `<h3>Onde assistir</h3>${body}${link}`;
};
