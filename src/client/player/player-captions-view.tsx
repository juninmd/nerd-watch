import { Button, Dialog, RadioGroup, Select } from '@juninmd/sonido';
import { type DragEvent, useEffect, useRef } from 'react';
import { getCaptions } from './player-dock.ts';
import { OFF } from './player-captions-model.ts';
import { formatOffset, OFFSET_BIG_STEP_MS, OFFSET_STEP_MS } from './player-captions-offset.ts';
import { CAPTION_BACKGROUNDS, type CaptionStyle } from './player-captions-prefs.ts';
import { usePlayerUi } from './player-ui-store.ts';

/** Botão CC e menu de legendas. Não decide nada: lê o estado do controlador (player-captions.ts) e devolve ações. */

const ACCEPT = '.srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip';

const OFFSET_BUTTONS: Array<[string, number | 'reset']> = [
  [`−${OFFSET_BIG_STEP_MS} ms`, -OFFSET_BIG_STEP_MS],
  [`−${OFFSET_STEP_MS} ms`, -OFFSET_STEP_MS],
  ['Zerar', 'reset'],
  [`+${OFFSET_STEP_MS} ms`, OFFSET_STEP_MS],
  [`+${OFFSET_BIG_STEP_MS} ms`, OFFSET_BIG_STEP_MS],
];

const SIZE_OPTIONS = [
  { value: 'sm', label: 'Pequena' },
  { value: 'md', label: 'Média' },
  { value: 'lg', label: 'Grande' },
  { value: 'xl', label: 'Muito grande' },
];
const BACKGROUND_OPTIONS = CAPTION_BACKGROUNDS.map((b) => ({ value: String(b), label: `${b}%` }));
const COLOR_OPTIONS = [
  { value: 'white', label: 'Branca' },
  { value: 'yellow', label: 'Amarela' },
];

/** Região de aviso estável: limpa e reescreve a cada aviso, para o leitor repetir até um texto igual ao anterior. */
function CaptionsAnnouncer({ text, seq }: { text: string; seq: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || seq === 0) return;
    el.textContent = '';
    queueMicrotask(() => {
      el.textContent = text;
    });
  }, [text, seq]);
  return <span ref={ref} className="sr-only" role="status" aria-live="polite" />;
}

export function CaptionsControl() {
  usePlayerUi();
  const captions = getCaptions();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!captions) return null;
  const vm = captions.view();
  const { actions } = captions;
  const open = captions.isOpen();
  const live = captions.announcement();
  const setStyle = (patch: Partial<CaptionStyle>) => actions.style({ ...vm.style, ...patch });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) actions.pickFile(file);
  };

  return (
    <div className="player-captions">
      <Button
        className="captions-btn"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Legendas: ${vm.currentLabel}`}
        data-active={String(vm.current !== OFF)}
        onClick={() => captions.setOpen(!open)}
      >
        CC
      </Button>
      <CaptionsAnnouncer text={live.text} seq={live.seq} />
      <Dialog open={open} onClose={() => captions.setOpen(false)} title="Legendas" className="captions-dialog">
        <RadioGroup
          label="Legenda"
          value={vm.current}
          onChange={actions.select}
          options={[
            { value: OFF, label: 'Desligadas' },
            ...vm.options.map((o) => ({ value: o.id, label: o.label, description: o.detail || undefined })),
          ]}
        />
        <div className="captions-actions">
          {vm.canSearch && (
            <Button
              variant="secondary"
              size="sm"
              disabled={vm.searchBusy}
              loading={vm.searchBusy}
              onClick={actions.search}
            >
              {vm.searchBusy ? 'Buscando legendas…' : 'Buscar legendas'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            Arquivo .srt ou .vtt…
          </Button>
        </div>
        {vm.message && (
          <p className="captions-hint" role="status">
            {vm.message}
          </p>
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: alvo de arrastar; o botão acima é o caminho por teclado */}
        <div className="captions-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          Ou arraste um arquivo .srt ou .vtt para cá
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) actions.pickFile(file);
          }}
        />
        <fieldset aria-label="Sincronia da legenda. Mais atrasa a legenda, menos adianta." className="captions-offset">
          <span>
            Sincronia <output>{formatOffset(vm.offsetMs)}</output>
          </span>
          {OFFSET_BUTTONS.map(([label, delta]) => (
            <Button key={label} variant="ghost" size="sm" onClick={() => actions.offset(delta)}>
              {label}
            </Button>
          ))}
        </fieldset>
        <fieldset aria-label="Aparência da legenda" className="captions-style">
          <Select
            label="Tamanho"
            options={SIZE_OPTIONS}
            value={vm.style.size}
            onChange={(v) => setStyle({ size: v as CaptionStyle['size'] })}
          />
          <Select
            label="Fundo"
            options={BACKGROUND_OPTIONS}
            value={String(vm.style.background)}
            onChange={(v) => setStyle({ background: Number(v) as CaptionStyle['background'] })}
          />
          <Select
            label="Cor"
            options={COLOR_OPTIONS}
            value={vm.style.color}
            onChange={(v) => setStyle({ color: v as CaptionStyle['color'] })}
          />
        </fieldset>
      </Dialog>
    </div>
  );
}
