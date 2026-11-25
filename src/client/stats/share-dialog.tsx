import type { StatsSummary } from '../../server/stats/summary.ts';
import { Dialog } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { shareCardPng } from './share-card.ts';
import { shareCardModel } from './share-model.ts';

type CardState = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' };

/** Cartão "Meu ano" em diálogo: PNG gerado no navegador, com baixar. Nada é enviado a lugar nenhum. */
export function ShareDialog({ s, onClose }: { s: StatsSummary; onClose: () => void }) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  const model = shareCardModel(s);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    shareCardPng(shareCardModel(s))
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setState({ kind: 'ready', url });
      })
      .catch(() => alive && setState({ kind: 'error' }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [s]);

  const status =
    state.kind === 'loading' ? 'Gerando cartão…' : state.kind === 'ready' ? 'Pronto. Baixe o PNG para compartilhar.' : 'Não foi possível gerar o cartão neste navegador.';
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Meu ano em ${s.year}`}
      description="Cartão gerado no seu navegador. Traz só totais do ano, nota média e gênero mais visto: nenhum título nem anotação."
      footer={
        state.kind === 'ready' && (
          // Link com `download`, não botão: o navegador salva o blob local. Sonido Button não aceita href.
          <a className="sn-button sn-button--primary sn-button--md" href={state.url} download={`nerd-watch-${s.year}.png`}>
            <span className="sn-button__label">Baixar PNG</span>
          </a>
        )
      }
    >
      <p className="stat-hint" role="status">
        {status}
      </p>
      {state.kind === 'ready' && <img className="stats-share-img" src={state.url} alt={`Cartão do ano ${s.year}: ${model.headline}`} />}
    </Dialog>
  );
}
