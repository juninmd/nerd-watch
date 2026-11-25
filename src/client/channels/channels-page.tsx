import { Button, ConfirmButton, EmptyState, Skeleton } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bulkDeleteTelegramChannels, listTelegramChannels, refreshTelegramChannelInfo, type TelegramChannelDto } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { originLabel } from '../connections/source-modes.ts';
import { Icon } from '../ui/icon.tsx';
import { PosterCard } from '../ui/poster-card.tsx';
import { ChannelAddForm } from './channel-add-form.tsx';
import { TelegramFeed } from './telegram-feed.tsx';
import { openMyChannelsDialog } from './telegram-my-channels.tsx';
import { PageHeader } from '../ui/page-header.tsx';

const INFO_BACKFILL_KEY = 'nw.telegram.infoBackfill';

/** Canais antigos ganham nome/foto/descrição e miniaturas uma vez por sessão do navegador (o servidor só faz o que falta). */
const claimInfoBackfill = (): boolean => {
  try {
    if (sessionStorage.getItem(INFO_BACKFILL_KEY)) return false;
    sessionStorage.setItem(INFO_BACKFILL_KEY, '1');
  } catch {
    // sem sessionStorage: tenta de novo na próxima visita
  }
  return true;
};

/** Canais e pastas: adicionar, novidades, importar da conta pessoal e a grade com seleção em lote. */
export function ChannelsPage({ query }: { query: URLSearchParams }) {
  const [channels, setChannels] = useState<TelegramChannelDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const loadSeq = useRef(0);
  const alive = useRef(true);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    listTelegramChannels()
      .then((data) => {
        if (!alive.current || seq !== loadSeq.current) return;
        setChannels(data.channels);
        const valid = new Set(data.channels.map((c) => c.titleId));
        setPicked((prev) => new Set([...prev].filter((id) => valid.has(id))));
        if (data.channels.length > 0 && claimInfoBackfill()) {
          refreshTelegramChannelInfo()
            .then((r) => {
              if (alive.current && r.updated > 0) load();
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (alive.current && seq === loadSeq.current) setFailed(true);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    // Atalho da paleta de comandos ("Importar meus canais"): abre o diálogo e limpa o parâmetro para não reabrir ao recarregar.
    if (query.get('import') === '1') {
      history.replaceState(null, '', '#/telegram');
      openMyChannelsDialog(load);
    }
    return () => {
      alive.current = false;
    };
  }, [load, query]);

  const list = channels ?? [];
  const toggleSelecting = () => {
    setSelecting((s) => !s);
    setPicked(new Set());
  };
  const toggleAll = () => setPicked(picked.size === list.length ? new Set() : new Set(list.map((c) => c.titleId)));
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const removePicked = () => {
    setDeleting(true);
    bulkDeleteTelegramChannels([...picked])
      .then((res) => {
        showToast(`${res.removed} canal(is) removido(s)`);
        setPicked(new Set());
        setSelecting(false);
        load();
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao remover'))
      .finally(() => setDeleting(false));
  };

  return (
    <>
      <PageHeader
        title="Canais e pastas"
        description={
          <>
            Adicione um canal do Telegram pelo @usuário, importe os canais da sua conta pessoal ou aponte uma fonte de vídeos (Google Drive, pasta local, WebDAV, Jellyfin, YouTube…; configure em{' '}
            <a href="#/connections">Conexões</a>) pra maratonar tudo aqui dentro. Modo bot exige um token grátis do @BotFather; modo conta pessoal exige um login único por QR code (faça em{' '}
            <a href="#/connections">Conexões</a>) e não tem limite de tamanho de arquivo. Os canais do Telegram entram com os vídeos mais recentes; dentro do canal dá para carregar os mais antigos e
            buscar pelo texto.
          </>
        }
      />
      <ChannelAddForm onAdded={load} />
      <TelegramFeed hideWhenEmpty channelsLink={false} />
      <div className="toolbar">
        <Button variant="ghost" size="sm" iconStart={<Icon name="send" size="sm" />} onClick={() => openMyChannelsDialog(load)}>
          meus canais
        </Button>
        <Button variant="ghost" size="sm" aria-pressed={selecting} iconStart={<Icon name={selecting ? 'x' : 'select'} size="sm" />} onClick={toggleSelecting}>
          {selecting ? 'cancelar seleção' : 'selecionar'}
        </Button>
        {selecting && (
          <span className="toolbar-selection">
            <span role="status">
              {picked.size} de {list.length} selecionado{picked.size === 1 ? '' : 's'}
            </span>
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {picked.size === list.length ? 'nenhum' : 'todos'}
            </Button>
            <ConfirmButton
              size="sm"
              disabled={picked.size === 0}
              loading={deleting}
              iconStart={<Icon name="trash" size="sm" />}
              ask={`Remover ${picked.size} canal(is) do app? Os vídeos importados e o status deles somem (os canais no Telegram não são afetados).`}
              confirmLabel="remover"
              onConfirm={removePicked}
            >
              remover
            </ConfirmButton>
          </span>
        )}
      </div>
      {failed && channels === null ? (
        <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar os canais" />
      ) : channels === null ? (
        <Skeleton label="carregando canais" rows={6} media />
      ) : list.length === 0 ? (
        <EmptyState icon={<Icon name="send" />} title="nenhum canal adicionado ainda" description='adicione um @usuário ou link acima, ou use "meus canais"' />
      ) : (
        <div className="grid">
          {list.map((ch) => (
            <PosterCard
              key={ch.titleId}
              title={ch.title}
              posterUrl={ch.posterUrl}
              meta={`${originLabel(ch.mode, ch.handle)} · ${ch.itemCount} vídeo${ch.itemCount === 1 ? '' : 's'}`}
              selection={selecting ? { selected: picked.has(ch.titleId), onToggle: () => togglePick(ch.titleId) } : undefined}
              onClick={() => navigate(`/telegram/${ch.titleId}`)}
            />
          ))}
        </div>
      )}
    </>
  );
}
