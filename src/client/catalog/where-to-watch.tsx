import { LinkButton } from './side-card.tsx';

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

/** Grupos com algum serviço, já com o rótulo e a contagem ("Alugar (2)"). Sem DOM: testável. */
export const providerGroups = (p: WatchProviders): Array<{ label: string; providers: ProviderDto[] }> =>
  GROUPS.filter((g) => p[g.key].length > 0).map((g) => ({
    label: `${g.label} (${p[g.key].length})`,
    providers: p[g.key],
  }));

/** Painel "Onde assistir": serviços agrupados pelo tipo de acesso; sem nenhum, explica em vez de ficar vazio. */
export function WhereToWatch({ providers }: { providers: WatchProviders }) {
  const groups = providerGroups(providers);
  return (
    <>
      <h3>Onde assistir</h3>
      {groups.length === 0 && <p className="hint">Nenhum streaming listado para a sua região.</p>}
      {groups.map((g) => (
        <div className="provider-group" key={g.label}>
          <div className="hint">{g.label}</div>
          <div className="provider-row">
            {g.providers.map((p) =>
              p.logoUrl ? (
                <div className="provider-logo" title={p.name} key={p.name}>
                  {/* Tamanho fixo e carga preguiçosa: sem salto de layout nem download fora da tela. */}
                  <img src={p.logoUrl} alt={p.name} width={40} height={40} loading="lazy" decoding="async" />
                </div>
              ) : (
                <span className="provider-name" key={p.name}>
                  {p.name}
                </span>
              ),
            )}
          </div>
        </div>
      ))}
      {providers.link && (
        <LinkButton href={providers.link} variant="primary">
          ver todas as opções no TMDB
        </LinkButton>
      )}
    </>
  );
}
