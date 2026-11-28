import { Button } from '@juninmd/sonido';
import { useEffect } from 'react';
import { getTitleStreams, type TitleStreamsQuery } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { type PlaySource, playPath, playTarget, type SeasonCount } from '../player/episode-play-model.ts';
import { Icon } from '../ui/icon.tsx';

export interface PlayTargetButtonProps {
  source: PlaySource;
  id: string;
  seasons: SeasonCount[];
  marker: { season: number; episode: number } | null;
  /** Consulta de streams do episódio alvo; ausente = sem id para buscar (o botão ainda abre o player). */
  query: (season: number, episode: number) => TitleStreamsQuery | null;
}

/**
 * "Assistir"/"Continuar" da ficha. Ao aparecer, já pede os streams do episódio alvo (como o stream-goat faz
 * ao abrir os detalhes): o servidor guarda a resposta dos addons em cache curto, então o player abre quase na hora.
 */
export function PlayTargetButton({ source, id, seasons, marker, query }: PlayTargetButtonProps) {
  const target = playTarget(seasons, marker);
  const q = target ? query(target.season, target.episode) : null;
  const key = q ? JSON.stringify(q) : '';
  useEffect(() => {
    // Só aquece o cache: falha aqui não importa, o player consulta de novo.
    if (q) void getTitleStreams(q).catch(() => undefined);
  }, [key]);
  if (!target) return null;
  const code = `T${target.season} E${target.episode}`;
  return (
    <Button
      variant="primary"
      iconStart={<Icon name="play" size="sm" />}
      onClick={() => navigate(playPath(source, id, target.season, target.episode))}
    >
      {target.resume ? `Continuar ${code}` : `Assistir ${code}`}
    </Button>
  );
}
