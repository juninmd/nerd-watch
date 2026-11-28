import { Artwork, Badge, Button, Card } from '@juninmd/sonido';
import { useState } from 'react';
import { Icon } from '../ui/icon.tsx';
import { episodeCode, type EpisodeState, type EpisodeView } from './episode-browser-model.ts';
import { dateLabel } from './tvmaze-view.ts';

export interface EpisodeCardProps {
  ep: EpisodeView;
  state: EpisodeState;
  onOpen: () => void;
  /** Ausente = série fora da sua lista (sem botão de marcar). */
  onMark?: () => Promise<void>;
  /** Episódio ainda não visto: imagem desfocada e sinopse escondida até "mostrar". */
  spoiler?: boolean;
}

/** Cartão do episódio: um botão invisível cobre o cartão (um só alvo para teclado e leitor) e o ✓ marca até ele. */
export function EpisodeCard({ ep, state, onOpen, onMark, spoiler = false }: EpisodeCardProps) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const hidden = spoiler && !shown;
  const code = episodeCode(ep);
  const label = `${code}, ${ep.name}${state === 'watched' ? ', visto' : state === 'current' ? ', onde você parou' : ''}`;
  const mark = () => {
    if (!onMark) return;
    setBusy(true);
    // Sucesso repinta a lista inteira com o marcador novo; só a falha precisa reabilitar o botão.
    onMark().catch(() => setBusy(false));
  };
  return (
    <Card className={`ep-card is-${state}${hidden ? ' is-spoiler' : ''}`} padding="none">
      <div className="ep-still" aria-hidden="true">
        <Artwork title={ep.name} src={ep.stillUrl ?? undefined} ratio="wide" />
        <span className="ep-play">
          <Icon name="play" size="sm" />
        </span>
      </div>
      <div className="ep-info">
        <span className="ep-code">
          {code}
          {state === 'current' ? ' · onde parou' : ''}
        </span>
        <h3>{ep.name}</h3>
        <div className="ep-meta">
          {ep.tag && <Badge>{ep.tag}</Badge>}
          {ep.rating ? <span className="ep-rate">★ {ep.rating.toFixed(1)}</span> : null}
          {ep.runtime ? <span>{ep.runtime} min</span> : null}
          <span>{ep.airDate ? dateLabel(ep.airDate) : 'data a confirmar'}</span>
        </div>
        {ep.overview && !hidden && <p>{ep.overview}</p>}
        {ep.overview && hidden && (
          <Button className="ep-reveal" variant="ghost" size="sm" onClick={() => setShown(true)}>
            Sinopse escondida · mostrar
          </Button>
        )}
      </div>
      <button type="button" className="ep-open" aria-label={`${label}: detalhes e onde assistir`} onClick={onOpen} />
      {onMark && state !== 'current' && (
        <Button
          className="ep-seen"
          variant={state === 'watched' ? 'primary' : 'secondary'}
          size="icon"
          disabled={busy}
          aria-pressed={state === 'watched'}
          aria-label={`${state === 'watched' ? 'Voltar o marcador para' : 'Marcar visto até'} ${code}`}
          onClick={mark}
        >
          <Icon name="check" size="sm" />
        </Button>
      )}
    </Card>
  );
}
