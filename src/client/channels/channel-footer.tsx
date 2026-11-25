import { Button } from '@juninmd/sonido';
import { useState } from 'react';
import { loadMoreTelegramHistory, searchTelegramHistory, type TelegramChannelDetailDto } from '../api/index.ts';
import { showToast } from '../app/state.ts';

/** Botão que roda uma ação demorada (fala com o Telegram) com feedback e sem clique duplo. */
function RemoteAction({ label, run, onDone }: { label: string; run: () => Promise<{ message: string; added: number }>; onDone: (added: number) => void }) {
  const [busy, setBusy] = useState(false);
  const click = () => {
    setBusy(true);
    run()
      .then(({ message, added }) => {
        showToast(message);
        setBusy(false);
        onDone(added);
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'não foi possível falar com o Telegram agora');
        setBusy(false);
      });
  };
  return (
    <Button variant="ghost" onClick={click} disabled={busy}>
      {busy ? 'carregando do Telegram…' : label}
    </Button>
  );
}

interface VideosFooterProps {
  d: TelegramChannelDetailDto;
  matches: number;
  visible: number;
  query: string;
  onShowMore: () => void;
  /** Vídeos novos vieram do Telegram: amplia a janela visível em `added` e recarrega o canal. */
  onLoaded: (added: number) => void;
}

/** Rodapé da lista: mostrar mais (local), buscar no Telegram, carregar mais antigos ou fim do histórico. */
export function VideosFooter({ d, matches, visible, query, onShowMore, onLoaded }: VideosFooterProps) {
  if (matches > visible) {
    return (
      <Button variant="ghost" onClick={onShowMore}>
        mostrar mais ({matches - visible})
      </Button>
    );
  }
  if (d.mode !== 'personal' && d.mode !== 'public') return null;
  const q = query.trim();
  if (q) {
    return (
      <RemoteAction
        key={`search-${q}`}
        label={`buscar “${q}” no Telegram`}
        onDone={onLoaded}
        run={async () => {
          const res = await searchTelegramHistory(d.titleId, q);
          const message = res.found === 0 ? 'o Telegram não achou nenhum vídeo com esse texto' : `${res.found} vídeo(s) achado(s), ${res.added} novo(s) na lista`;
          return { message, added: res.added };
        }}
      />
    );
  }
  if (d.canLoadMore) {
    return (
      <RemoteAction
        key="older"
        label="carregar vídeos mais antigos"
        onDone={onLoaded}
        run={async () => {
          const res = await loadMoreTelegramHistory(d.titleId);
          const message = res.exhausted ? `${res.added} vídeo(s) a mais — esse é o começo do histórico` : `${res.added} vídeo(s) mais antigos carregados`;
          return { message, added: res.added };
        }}
      />
    );
  }
  return d.items.length > 0 ? <p className="hint">fim do histórico: todos os vídeos desse canal já estão aqui.</p> : null;
}
