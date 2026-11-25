import { Button, Select, TextField } from '@juninmd/sonido';
import { type FormEvent, useEffect, useState } from 'react';
import { addTelegramChannel, type TelegramChannelMode } from '../api/index.ts';
import { addSourceChannel, listSources, type SourceDto } from '../api/sources.ts';
import { showToast } from '../app/state.ts';
import { handleLabel, isTelegramMode } from '../connections/source-modes.ts';

const TELEGRAM_OPTIONS = [
  { value: 'public', label: 'canal público (sem login)' },
  { value: 'bot', label: 'bot (precisa de TELEGRAM_BOT_TOKEN)' },
  { value: 'personal', label: 'conta pessoal (sem limite de tamanho)' },
];

const DEFAULT_PLACEHOLDER = '@usuario ou link do t.me (inclui t.me/c/… de canal privado)';

/** O rótulo da fonte pode não citar o serviço ("biblioteca…", "bucket…"): sem prefixo as opções ficam ambíguas. */
const sourceLabel = (s: SourceDto & { add: NonNullable<SourceDto['add']> }): string => {
  const label = s.add.label.toLowerCase().includes(s.title.toLowerCase()) ? s.add.label : `${s.title}: ${s.add.label}`;
  return s.configured ? label : `${label} — configure em Conexões`;
};

/** Adicionar canal do Telegram ou fonte de vídeo (Drive, WebDAV…, vindas do descritor do servidor). */
export function ChannelAddForm({ onAdded }: { onAdded: () => void }) {
  const [handle, setHandle] = useState('');
  const [mode, setMode] = useState<TelegramChannelMode>('public');
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listSources()
      .then((list) => {
        if (alive) setSources(list.filter((s) => s.add));
      })
      // Sem a lista só os modos do Telegram ficam disponíveis.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const source = sources.find((s) => s.add?.mode === mode);
  const options = [...TELEGRAM_OPTIONS, ...sources.flatMap((s) =>
      s.add ? [{ value: s.add.mode, label: sourceLabel({ ...s, add: s.add }), disabled: !s.configured }] : [],
    ),
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = handle.trim();
    if (!value) return;
    setBusy(true);
    try {
      const channel = isTelegramMode(mode) ? await addTelegramChannel(value, mode) : await addSourceChannel(mode, value);
      setHandle('');
      showToast(`${isTelegramMode(mode) ? `canal ${handleLabel(channel.handle, channel.title)}` : channel.title} adicionado — ${channel.itemCount} vídeo(s)`);
      onAdded();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao adicionar canal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="chip-row form-row" onSubmit={submit}>
      <TextField
        className="grow"
        label={source?.add?.label ?? '@usuário ou link do canal'}
        placeholder={source?.add?.placeholder ?? DEFAULT_PLACEHOLDER}
        hint={source?.add?.hint}
        autoComplete="off"
        value={handle}
        onChange={(e) => setHandle(e.currentTarget.value)}
      />
      <Select label="modo do canal" options={options} value={mode} onChange={(v) => setMode(v as TelegramChannelMode)} />
      <Button variant="primary" size="sm" type="submit" loading={busy}>
        adicionar
      </Button>
    </form>
  );
}
