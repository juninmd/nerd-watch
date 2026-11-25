import { Artwork, Avatar, Badge, Dialog, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { getTvmazePersonCard, type TvmazePersonCardDto } from '../api/index.ts';
import { openOverlay } from '../ui/overlay.tsx';
import { titlePath } from '../ui/title-link.ts';
import { personFacts } from './person-facts.ts';

export interface PersonModalSeed {
  id: number;
  name: string;
  imageUrl: string | null;
  /** Personagem na série aberta. */
  role: string | null;
  seriesTitle: string;
  /** Série aberta: sai da lista de "outras séries". */
  currentShowId: number | null;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ok'; card: TvmazePersonCardDto };

function Shows({
  card,
  currentShowId,
  onNav,
}: {
  card: TvmazePersonCardDto;
  currentShowId: number | null;
  onNav: () => void;
}) {
  const shows = card.shows.filter((s) => s.showId !== currentShowId);
  if (shows.length === 0) return <p className="hint">Sem outras séries listadas na TVmaze.</p>;
  return (
    <ul className="prem-credits">
      {shows.map((s) => (
        <li key={s.showId}>
          {/* Link interno troca a rota por trás: fecha o modal junto para não ficar por cima da tela nova. */}
          <a href={`#${titlePath('tvmaze', 'tv', String(s.showId))}`} onClick={onNav}>
            <Artwork
              title={s.name}
              src={s.posterUrl ?? undefined}
              ratio="poster"
              badge={s.voice ? <Badge tone="aqua">voz</Badge> : undefined}
            />
            <strong>{s.name}</strong>
            {s.role && <span className="dim">{s.role}</span>}
            <span className="dim mono">
              {[s.year, s.rating ? `★ ${s.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function PersonDialog({ seed, onClose }: { seed: PersonModalSeed; onClose: () => void }) {
  const [res, setRes] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    getTvmazePersonCard(seed.id)
      .then((card) => live && setRes({ status: 'ok', card }))
      .catch(() => live && setRes({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [seed.id]);
  const personHref = `#/person/tvmaze/${seed.id}`;
  return (
    <Dialog open onClose={onClose} title={seed.name} className="person-modal">
      <div className="person-modal-head">
        <Avatar name={seed.name} src={seed.imageUrl ?? undefined} size={104} />
        <div className="person-modal-id">
          <span className="eyebrow">Elenco · {seed.seriesTitle}</span>
          {seed.role && <span className="dim">{seed.role}</span>}
          {res.status === 'ok' && <span className="hint">{personFacts(res.card.person).join(' · ')}</span>}
        </div>
      </div>
      <div className="person-modal-body" aria-busy={res.status === 'loading' || undefined}>
        {res.status === 'loading' && <Skeleton rows={4} label="Carregando pessoa…" />}
        {res.status === 'error' && (
          <p className="hint" role="alert">
            Não foi possível carregar os dados agora.{' '}
            <a href={personHref} onClick={onClose}>
              Abrir a página da pessoa
            </a>
          </p>
        )}
        {res.status === 'ok' && (
          <>
            {res.card.bio ? (
              <section aria-label="Biografia">
                <p className="person-bio">{res.card.bio.extract}</p>
                <p className="hint">
                  Resumo da{' '}
                  <a href={res.card.bio.url} target="_blank" rel="noopener noreferrer">
                    Wikipédia{res.card.bio.lang === 'en' ? ' (em inglês)' : ''}
                  </a>
                  , licença CC BY-SA.
                </p>
              </section>
            ) : (
              <p className="hint">Sem biografia confiável encontrada para esta pessoa.</p>
            )}
            <section aria-labelledby="person-modal-shows">
              <h3 id="person-modal-shows">
                Outras séries <span className="dim">{res.card.person.cast.length} créditos na TV</span>
              </h3>
              <Shows card={res.card} currentShowId={seed.currentShowId} onNav={onClose} />
            </section>
            <p className="hint">
              Filmes não aparecem: a TVmaze só cobre TV.{' '}
              <a href={personHref} onClick={onClose}>
                Ver página completa
              </a>{' '}
              · dados:{' '}
              <a href={res.card.attribution.url} target="_blank" rel="noopener noreferrer">
                TVmaze
              </a>
              .
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

let closeOpen: (() => void) | null = null;

/** Modal de uma pessoa do elenco: foto e personagem na hora; dados, mini bio e outras séries assim que chegam. */
export const openPersonModal = (seed: PersonModalSeed): void => {
  closeOpen?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = openOverlay((closeOverlay) => (
    <PersonDialog
      seed={seed}
      onClose={() => {
        closeOverlay();
        if (closeOpen === close) closeOpen = null;
        if (opener?.isConnected) opener.focus();
      }}
    />
  ));
  closeOpen = close;
};
