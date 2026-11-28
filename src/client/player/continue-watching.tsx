import { Button, ProgressBar } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { canShareAppLink, copyAppLink } from '../app/share-link.ts';
import { watchPath } from '../channels/telegram-items.ts';
import { mediaUrl } from '../platform/tauri.ts';
import { posterCssUrl } from '../ui/poster-css.ts';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';
import {
  clearContinueWatching,
  continueWatching,
  markContinueWatchingDone,
  removeFromContinueWatching,
} from './playback-positions.ts';
import { PLAYBACK_CHANGED_EVENT } from './playback-sync.ts';

const MAX_CARDS = 12;

type Entry = ReturnType<typeof continueWatching>[number];

function ResumeCard({ entry, onRemove }: { entry: Entry; onRemove(): void }) {
  const { meta, position, resumeAt } = entry;
  const total = position.duration && position.duration > 0 ? position.duration : null;
  const percent = total ? Math.min(100, Math.round((resumeAt / total) * 100)) : 0;
  const left = total ? formatDuration(Math.max(0, Math.round(total - resumeAt))) : null;
  const route = meta.route ?? watchPath(meta.channelId, meta.messageId);
  const go = () => navigate(route);
  return (
    // biome-ignore lint/a11y/useSemanticElements: o card tem botões dentro, então não pode ser um <a>; o papel de link fica no contêiner
    <div
      className="resume-card"
      role="link"
      tabIndex={0}
      aria-label={`continuar ${meta.title} de ${formatDuration(resumeAt)}`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') go();
      }}
    >
      <div
        className={`resume-thumb${meta.poster ? '' : ' placeholder'}`}
        style={meta.poster ? { backgroundImage: posterCssUrl(mediaUrl(meta.poster)) } : undefined}
      >
        {!meta.poster && <Icon name="film" />}
        <div className="resume-text">
          <b>{meta.title}</b>
          <small>
            {meta.subtitle} · {left ? `faltam ${left}` : `parou em ${formatDuration(resumeAt)}`}
          </small>
        </div>
        <ProgressBar className="resume-bar" size="sm" value={percent} label={`${percent}% assistido`} />
      </div>
      <div className="resume-actions">
        <Button
          className="resume-action"
          variant="ghost"
          size="icon"
          aria-label={`marcar ${meta.title} como visto`}
          title="Marcar como visto"
          onClick={(e) => {
            e.stopPropagation();
            markContinueWatchingDone(entry.key);
            onRemove();
          }}
        >
          <Icon name="check" size="sm" />
        </Button>
        {canShareAppLink() && (
          <Button
            className="resume-action"
            variant="ghost"
            size="icon"
            aria-label={`copiar link para continuar ${meta.title}`}
            title="Copiar link para continuar"
            onClick={(e) => {
              e.stopPropagation();
              copyAppLink(route, { at: resumeAt, label: 'Link para continuar' });
            }}
          >
            <Icon name="link" size="sm" />
          </Button>
        )}
        <Button
          className="resume-action"
          variant="ghost"
          size="icon"
          aria-label={`remover ${meta.title} de continuar assistindo`}
          title="Remover de continuar assistindo"
          onClick={(e) => {
            e.stopPropagation();
            removeFromContinueWatching(entry.key);
            onRemove();
          }}
        >
          <Icon name="x" size="sm" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Cards dos vídeos que o usuário começou e não terminou (posição salva neste navegador), sem contêiner: quem chama
 * os põe no trilho. Relê ao sincronizar (`PLAYBACK_CHANGED_EVENT`) e conta quantos há via `onCountChange`.
 */
export function ContinueWatchingCards({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [entries, setEntries] = useState(() => continueWatching(MAX_CARDS));
  useEffect(() => {
    const reload = () => setEntries(continueWatching(MAX_CARDS));
    window.addEventListener(PLAYBACK_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PLAYBACK_CHANGED_EVENT, reload);
  }, []);
  useEffect(() => onCountChange?.(entries.length), [entries.length, onCountChange]);
  return entries.map((entry) => (
    <ResumeCard
      key={entry.key}
      entry={entry}
      onRemove={() => setEntries((list) => list.filter((e) => e.key !== entry.key))}
    />
  ));
}

/** Confirma e apaga todas as posições em andamento; devolve quantas saíram (0 se cancelou). Os cards se redesenham. */
export const confirmClearContinueWatching = (): number => {
  if (
    !confirm(
      'Limpar tudo de "Continuar assistindo"? Só o progresso some; os vídeos continuam nos canais e na biblioteca.',
    )
  )
    return 0;
  return clearContinueWatching();
};
