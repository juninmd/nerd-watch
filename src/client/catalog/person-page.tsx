import { Artwork, EmptyState, Skeleton } from '@juninmd/sonido';
import { getTvmazePerson, type TvmazePersonDto } from '../api/index.ts';
import { BackLink } from '../ui/back.tsx';
import { pluralize } from '../ui/pluralize.ts';
import { titlePath } from '../ui/title-link.ts';
import { groupCredits, personFacts } from './person-facts.ts';
import { LinkButton } from './side-card.tsx';
import { TitleError } from './title-error.tsx';
import { useLoad } from './use-load.ts';

function Credits({ heading, credits }: { heading: string; credits: TvmazePersonDto['cast'] }) {
  if (credits.length === 0) return null;
  const byShow = groupCredits(credits);
  return (
    <>
      <div className="section-head">
        <h2>
          {heading} <span className="dim">· {pluralize(byShow.length, 'série', 'séries')}</span>
        </h2>
      </div>
      <div className="tvm-credits">
        {byShow.map((e) => (
          <a className="tvm-credit" href={`#${titlePath('tvmaze', 'tv', String(e.showId))}`} key={e.showId}>
            <strong>{e.name}</strong>
            {e.roles.length > 0 && <span className="dim">{e.roles.join(', ')}</span>}
          </a>
        ))}
      </div>
    </>
  );
}

/** Página de uma pessoa da TVmaze: foto, dados e créditos de elenco e equipe (cada série leva à ficha dela). */
export function TvmazePersonPage({ id }: { id: string }) {
  const { data: p, error, retry } = useLoad(() => getTvmazePerson(id), id);
  if (error) return <TitleError onRetry={retry} />;
  if (!p) return <Skeleton media rows={4} label="Carregando pessoa…" />;
  const facts = personFacts(p);
  return (
    <div>
      <BackLink href="#/search" label="Voltar" useHistory />
      <div className="tvm-person-head">
        <div className="tvm-portrait">
          <Artwork title={p.name} src={p.imageUrl ?? undefined} ratio="poster" />
        </div>
        <div>
          <h1 className="view-title">{p.name}</h1>
          <p className="view-subtitle">{facts.join(' · ') || 'sem dados pessoais na TVmaze'}</p>
          {p.pageUrl && <LinkButton href={p.pageUrl}>ver na TVmaze</LinkButton>}
        </div>
      </div>
      <Credits heading="Atuação" credits={p.cast} />
      <Credits heading="Equipe" credits={p.crew} />
      {p.cast.length + p.crew.length === 0 && <EmptyState title="sem créditos listados" />}
      <p className="hint">
        Dados:{' '}
        <a href={p.attribution.url} target="_blank" rel="noopener noreferrer">
          TVmaze
        </a>
        , licença {p.attribution.license ?? 'CC BY-SA'}.
      </p>
    </div>
  );
}
