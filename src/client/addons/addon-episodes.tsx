import { Button, Card, SearchField, Select } from '@juninmd/sonido';
import { useState } from 'react';
import { episodeLabel } from './addon-episode.ts';
import { type AddonVideo, filterEpisodes, groupEpisodes } from './episode-model.ts';

interface AddonEpisodesProps {
  episodes: readonly AddonVideo[];
  /** Episódio aberto agora: a lista marca e a temporada acompanha. */
  current: string;
  onPick: (id: string) => void;
}

/** "Extras" (season null) vira o valor vazio do `<select>`. */
const seasonValue = (season: number | null): string => (season === null ? '' : String(season));

/** Episódios do item do addon por temporada, com filtro por nome ou número. */
export function AddonEpisodes({ episodes, current, onPick }: AddonEpisodesProps) {
  const seasons = groupEpisodes(episodes);
  const [season, setSeason] = useState<number | null>(seasons[0]?.season ?? null);
  const [filter, setFilter] = useState('');
  const [followed, setFollowed] = useState(current);

  // Episódio de outra temporada (link direto, "continuar assistindo"): troca a temporada antes de marcar.
  if (followed !== current) {
    setFollowed(current);
    const ep = episodes.find((v) => v.id === current);
    if (ep && (ep.season ?? null) !== season) setSeason(ep.season ?? null);
  }

  const group = seasons.find((s) => s.season === season) ?? seasons[0];
  const visible = filterEpisodes(group?.episodes ?? [], filter);

  return (
    <Card className="side-card">
      <h3>Episódios</h3>
      <div className="chip-row form-row">
        {/* Uma temporada só não precisa de seletor. */}
        {seasons.length > 1 && (
          <Select
            label="temporada"
            value={seasonValue(season)}
            options={seasons.map((s) => ({ value: seasonValue(s.season), label: `${s.label} (${s.episodes.length})` }))}
            onChange={(v) => setSeason(v === '' ? null : Number(v))}
          />
        )}
        <SearchField
          className="grow"
          label="filtrar episódio"
          placeholder="filtrar episódio"
          autoComplete="off"
          value={filter}
          onChange={setFilter}
        />
      </div>
      <ul className="stream-list">
        {visible.map((v) => (
          <li key={v.id}>
            <Button
              className="stream-btn"
              variant="ghost"
              size="sm"
              aria-current={v.id === current ? 'true' : undefined}
              onClick={() => onPick(v.id)}
            >
              {episodeLabel(v)}
            </Button>
          </li>
        ))}
      </ul>
      {/* Temporada sem resultado do filtro: mensagem em vez de lista vazia sem explicação. */}
      {visible.length === 0 && <p className="hint">nenhum episódio com esse filtro.</p>}
    </Card>
  );
}
