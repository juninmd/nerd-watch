import { Alert, Button } from '@juninmd/sonido';
import { StreamCard } from './stream-card.tsx';
import type { AddonStreamGroup as Group, AddonStreamItem as Stream } from './stream-lookup.ts';
import { atAddonCap, previewStreams, STREAM_PREVIEW } from './stream-preview.ts';

export interface StreamGroupProps {
  group: Group;
  /** Lista longa aberta pelo usuário ("mostrar todos"). */
  expanded: boolean;
  onToggle: () => void;
  onPlay: (stream: Stream) => void;
  /** `index` do stream tocando agora neste addon; `null` = nenhum. */
  playingIndex: number | null;
}

function GroupBody({ group, expanded, onToggle, onPlay, playingIndex }: StreamGroupProps) {
  if (group.error) return <Alert tone="danger">erro: {group.error}</Alert>;
  if (group.streams.length === 0) return <p className="hint">nenhum stream para este título.</p>;

  const preview = previewStreams(group.streams, expanded);
  // Um botão só (troca o rótulo): o foco fica nele ao abrir e fechar a lista longa.
  const toggle = preview.hidden > 0 ? `mostrar todos (${preview.total})` : expanded && preview.total > STREAM_PREVIEW ? 'mostrar menos' : null;
  return (
    <>
      <ul className="stream-list">
        {preview.visible.map((s) => (
          <StreamCard key={s.index} stream={s} playing={s.index === playingIndex} onPlay={() => onPlay(s)} />
        ))}
      </ul>
      {toggle && (
        <Button className="stream-more" variant="ghost" size="sm" aria-expanded={expanded} onClick={onToggle}>
          {toggle}
        </Button>
      )}
      {/* Teto do addon: a lista "acaba" em 500 porque o addon para ali, não porque o catálogo acabou. */}
      {atAddonCap(preview.total) && <p className="hint">o addon devolveu o limite dele de streams; refine a configuração do addon para ver menos.</p>}
    </>
  );
}

/** Streams de um addon; quando o id veio do catálogo do addon, o cabeçalho diz de onde saiu o match. */
export function StreamGroup(props: StreamGroupProps) {
  const { group } = props;
  return (
    <div className="addon-stream-group">
      <h4>
        {group.name} <small>{group.host}</small>
        {group.matchedTitle && <small className="stream-via">via catálogo: {group.matchedTitle}</small>}
      </h4>
      <GroupBody {...props} />
    </div>
  );
}
