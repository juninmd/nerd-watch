import { Badge, Button, Spinner } from '@juninmd/sonido';
import { Icon } from '../ui/icon.tsx';
import { allAnswered, type Collected, hasPlayable } from './source-collector.ts';

/** Tela de carregamento do episódio: cada addon com o que já mandou e "Tocar agora" para não esperar o resto. */
export function SourceCollectorCard({ collected, onPlayNow }: { collected: Collected; onPlayNow: () => void }) {
  const done = collected.addons.filter((a) => a.status !== 'pending').length;
  return (
    <div className="source-collector" role="status" aria-live="polite">
      <p className="source-collector__head">
        {!allAnswered(collected) && <Spinner size={14} />}
        <b>
          Procurando fontes… {done} de {collected.addons.length} addons
        </b>
      </p>
      <ul className="source-collector__list">
        {collected.addons.map((a) => (
          <li key={a.addonId} className={`is-${a.status}`}>
            <span>{a.name}</span>
            {a.status === 'pending' && <span className="dim">aguardando</span>}
            {a.status === 'error' && <Badge tone="danger">sem resposta</Badge>}
            {a.status === 'done' && (
              <Badge tone={a.count ? 'success' : 'neutral'}>
                {a.count ? `${a.count} fonte${a.count === 1 ? '' : 's'}${a.bestHeight ? ` · até ${a.bestHeight}p` : ''}` : 'nada'}
              </Badge>
            )}
          </li>
        ))}
      </ul>
      <Button variant="primary" size="sm" iconStart={<Icon name="play" size="sm" />} disabled={!hasPlayable(collected)} onClick={onPlayNow}>
        Tocar agora
      </Button>
    </div>
  );
}
