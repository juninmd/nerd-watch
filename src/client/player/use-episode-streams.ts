import { useCallback, useEffect, useRef, useState } from 'react';
import { getTitleStreams, listAddons, type TitleStreamsDto, type TitleStreamsQuery } from '../api/stremio.ts';
import { pickStream, type StreamPick } from './episode-play-model.ts';
import { readStreamPref } from './episode-play-pref.ts';
import type { Streams } from './episode-play-side.tsx';
import { addAnswer, allAnswered, type Collected, readyToStart, startCollect } from './source-collector.ts';

/**
 * Fontes do episódio. Com vários addons, um pedido por addon: `collect` alimenta a tela de carregamento e a
 * escolha sai sem esperar o mais lento (ver source-collector.ts). `playNow` = "Tocar agora".
 */
export const useEpisodeStreams = (
  query: TitleStreamsQuery | { unavailable: string },
  titleKey: string,
  explicit: StreamPick | null,
): { streams: Streams; collect: Collected | null; playNow: () => void } => {
  const [streams, setStreams] = useState<Streams>({ kind: 'loading' });
  const [collect, setCollect] = useState<Collected | null>(null);
  const collected = useRef<Collected | null>(null);
  const started = useRef(false);

  /** Entrega a lista ao painel e escolhe a fonte; depois disso, quem chega tarde só entra na lista. */
  const start = useCallback(
    (dto: TitleStreamsDto) => {
      started.current = true;
      if (!dto.addons.length) setStreams({ kind: 'none', message: 'Nenhum addon de streams instalado.' });
      else setStreams({ kind: 'ready', dto, pick: pickStream(dto, readStreamPref(titleKey), explicit) });
    },
    [titleKey, explicit],
  );
  // A consulta roda uma vez por episódio; a escolha explícita (link com ?addon=) pode mudar sem remontar.
  const latest = useRef({ start, explicit });
  latest.current = { start, explicit };

  useEffect(() => {
    if ('unavailable' in query) return setStreams({ kind: 'none', message: query.unavailable });
    let alive = true;
    const fail = () =>
      alive && setStreams({ kind: 'none', message: 'Não foi possível consultar os addons agora.', alert: true });
    const pref = readStreamPref(titleKey);
    listAddons()
      .then((list) => list.filter((a) => a.enabled && a.resources.includes('stream')))
      .catch(() => [])
      .then((addons) => {
        if (!alive) return;
        // Um addon (ou lista indisponível): uma consulta só, como antes.
        if (addons.length <= 1) {
          getTitleStreams(query)
            .then((dto) => alive && latest.current.start(dto))
            .catch(fail);
          return;
        }
        // Vários: um pedido por addon; a tela mostra cada um chegando e começa sem esperar o mais lento.
        collected.current = startCollect(addons);
        setCollect(collected.current);
        for (const addon of addons) {
          getTitleStreams({ ...query, only: addon.id })
            .catch(() => null)
            .then((answer) => {
              if (!alive || !collected.current) return;
              const c = addAnswer(collected.current, addon.id, answer);
              collected.current = c;
              setCollect(c);
              const want = latest.current.explicit;
              const explicitIn = want !== null && c.addons.some((a) => a.addonId === want.addonId && a.status !== 'pending');
              if (!started.current && (readyToStart(c, pref) || explicitIn)) latest.current.start(c.dto);
              else if (started.current)
                setStreams((cur) => (cur.kind === 'ready' ? { ...cur, dto: c.dto } : cur));
              if (allAnswered(c) && !c.dto.addons.length) fail();
            });
        }
      });
    return () => {
      alive = false;
    };
    // uma consulta por episódio (a tela remonta a cada rota)
  }, []);

  const playNow = useCallback(() => {
    if (collected.current && !started.current) start(collected.current.dto);
  }, [start]);
  return { streams, collect, playNow };
};
