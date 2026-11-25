import { Badge, Button, Dialog, RadioGroup, SearchField, TextField } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type LibraryItemDto, linkTelegramItem, listLibrary, type TelegramItemLinkDto, unlinkTelegramItem } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { openDialog } from './open-dialog.tsx';
import { normalizeSearch } from './telegram-items.ts';

const episodeLabel = (l: TelegramItemLinkDto): string => `T${l.seasonNumber} · Ep ${l.episodeNumber}${l.episodeEnd ? `–${l.episodeEnd}` : ''}`;

/** Só pôster https: a lista do canal não carrega imagem de origem arbitrária. */
const safePoster = (url: string | null): string | undefined => (url && /^https:\/\/[^\s'"()\\<>]+$/.test(url) ? url : undefined);

/**
 * Selo do vínculo na lista do canal: confirmado (com o pôster e o nome do título) ou sugestão para confirmar.
 * A confiança aparece só na sugestão, em texto: o usuário decide com a informação na frente.
 */
export function LinkBadge({ link }: { link: TelegramItemLinkDto | null }) {
  if (!link) return null;
  const name = link.title ?? 'título da biblioteca';
  const src = safePoster(link.posterUrl);
  const pct = link.confidence === null ? '' : ` (${Math.round(link.confidence * 100)}%)`;
  return (
    <div className="tg-link-line">
      {src && <img className="tg-link-poster" src={src} alt="" loading="lazy" />}
      {link.status === 'linked' ? (
        <Badge tone="accent">
          vinculado · {name} · {episodeLabel(link)}
        </Badge>
      ) : (
        <Badge>
          sugerido{pct}: {name} · {episodeLabel(link)} — confirme
        </Badge>
      )}
    </div>
  );
}

export interface LinkDialogOptions {
  channelId: string;
  messageId: string;
  current: TelegramItemLinkDto | null;
  onDone: () => void;
}

/** Só séries da biblioteca entram na lista, porque o servidor recusa qualquer outro título. */
function LinkDialog({ opts, onClose }: { opts: LinkDialogOptions; onClose: () => void }) {
  const [series, setSeries] = useState<LibraryItemDto[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(opts.current?.titleId ?? '');
  const [season, setSeason] = useState(String(opts.current?.seasonNumber ?? 1));
  const [episode, setEpisode] = useState(String(opts.current?.episodeNumber ?? 1));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listLibrary()
      .then((res) => {
        if (alive) setSeries(res.items.filter((it) => it.title.mediaType === 'tv'));
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const finish = () => {
    onClose();
    opts.onDone();
  };

  const save = () => {
    const seasonNumber = Number(season);
    const episodeNumber = Number(episode);
    if (season.trim() === '' || episode.trim() === '' || !selected || !Number.isInteger(seasonNumber) || seasonNumber < 0 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
      setError('Informe a temporada (0 a 999) e o episódio (1 a 9999).');
      return;
    }
    setBusy(true);
    setError('');
    linkTelegramItem(opts.channelId, opts.messageId, { titleId: selected, seasonNumber, episodeNumber })
      .then(finish)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'não foi possível vincular agora');
        setBusy(false);
      });
  };

  const clear = () => {
    setBusy(true);
    unlinkTelegramItem(opts.channelId, opts.messageId)
      .then(finish)
      .catch(() => {
        setBusy(false);
        showToast('não foi possível remover o vínculo agora');
      });
  };

  const words = normalizeSearch(q).split(' ').filter(Boolean);
  const matches = (series ?? []).filter((it) => words.every((w) => normalizeSearch(it.title.title).includes(w)));
  const footer = (
    <>
      <Button variant="primary" onClick={save} disabled={!selected} loading={busy}>
        Vincular
      </Button>
      {opts.current && (
        <Button variant="ghost" onClick={clear} disabled={busy}>
          Sem vínculo
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
    </>
  );
  return (
    <Dialog open onClose={onClose} title="Vincular a um título" description="Escolha uma série da sua biblioteca e o episódio que este vídeo mostra." footer={footer}>
      <SearchField label="Buscar na biblioteca" value={q} onChange={setQ} autoFocus autoComplete="off" />
      <div className="tg-link-list">
        {loadFailed ? (
          <p className="hint">não foi possível carregar a biblioteca agora</p>
        ) : series === null ? (
          <p className="hint">carregando…</p>
        ) : matches.length ? (
          <RadioGroup label="Séries da biblioteca" value={selected} onChange={setSelected} options={matches.map((it) => ({ value: it.titleId, label: it.title.title }))} />
        ) : (
          <p className="hint">{series.length === 0 ? 'Nenhuma série na sua biblioteca ainda. Adicione a série primeiro.' : 'Nenhuma série com esse nome na biblioteca.'}</p>
        )}
      </div>
      <div className="tg-link-episode">
        <TextField label="Temporada" type="number" min={0} max={999} inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value)} />
        <TextField label="Episódio" type="number" min={1} max={9999} inputMode="numeric" value={episode} onChange={(e) => setEpisode(e.target.value)} />
      </div>
      <p className="hint tg-link-error" role="alert">
        {error}
      </p>
    </Dialog>
  );
}

/** Abre o diálogo de vínculo; o foco volta a quem abriu ao fechar. */
export const openLinkDialog = (opts: LinkDialogOptions): void => openDialog((close) => <LinkDialog opts={opts} onClose={close} />);
