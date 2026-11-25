import type { StatsSummary } from '../../server/stats/summary.ts';
import { Button, EmptyState, Select, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { openDialog } from '../app/open-dialog.ts';
import { navigate } from '../app/router.ts';
import { getStats } from '../api/index.ts';
import { Icon } from '../ui/icon.tsx';
import { browserTimeZone } from '../ui/time-format.ts';
import { yearOptions } from './model.ts';
import { ShareDialog } from './share-dialog.tsx';
import { StatsBody } from './stats-body.tsx';

/** Ritmo da fila (horas por dia): preferência do navegador, então fica em localStorage (com try/catch). */
const HPD_OPTIONS = [0.5, 1, 2, 3, 4];
const HPD_KEY = 'nw:stats-hpd';
const DEFAULT_HPD = 1;

const readHpd = (): number => {
  try {
    const v = Number(localStorage.getItem(HPD_KEY));
    return HPD_OPTIONS.includes(v) ? v : DEFAULT_HPD;
  } catch {
    return DEFAULT_HPD;
  }
};

const saveHpd = (v: number): void => {
  try {
    localStorage.setItem(HPD_KEY, String(v));
  } catch {
    // sem armazenamento (aba privada): a escolha vale só nesta tela
  }
};

const parseYear = (raw: string | null): number | null => {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 1970 && y <= 2100 ? y : null;
};

type Load = { kind: 'loading' } | { kind: 'ok'; s: StatsSummary } | { kind: 'error'; message: string };

/** Tela de estatísticas: seletor de ano (na URL, para voltar e compartilhar o link), ritmo da fila e o resumo. */
export function StatsPage({ query }: { query: URLSearchParams }) {
  const currentYear = new Date().getFullYear();
  const year = parseYear(query.get('year')) ?? currentYear;
  const [hpd, setHpd] = useState(readHpd);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [latest, setLatest] = useState<StatsSummary | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    // Só a resposta mais recente aparece: trocar o ritmo depressa não mistura números.
    let alive = true;
    setBusy(true);
    getStats({ year, tz: browserTimeZone(), hpd })
      .then((s) => {
        if (!alive) return;
        setBusy(false);
        setLoad({ kind: 'ok', s });
        setLatest(s);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setBusy(false);
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'erro desconhecido' });
      });
    return () => {
      alive = false;
    };
  }, [year, hpd]);

  const years = latest ? yearOptions(latest.firstYear, currentYear) : [year];
  if (!years.includes(year)) years.unshift(year);

  return (
    <div>
      <header className="view-head">
        <h1 className="view-title">Estatísticas</h1>
        <p className="view-subtitle">Seu ano na lista: conclusões, tempo, gêneros e notas. Calculado no seu aparelho a partir do histórico.</p>
      </header>
      <fieldset className="stats-toolbar">
        <legend className="sn-visually-hidden">Filtros das estatísticas</legend>
        <Select
          label="Ano"
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          value={String(year)}
          onChange={(v) => navigate(`/stats?year=${v}`)}
        />
        <Select
          label="Ritmo da fila"
          options={HPD_OPTIONS.map((h) => ({ value: String(h), label: `${h.toString().replace('.', ',')} h por dia` }))}
          value={String(hpd)}
          onChange={(v) => {
            const next = Number(v);
            saveHpd(next);
            setHpd(next);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          iconStart={<Icon name="download" size="sm" />}
          onClick={() => {
            if (latest) openDialog((close) => <ShareDialog s={latest} onClose={close} />);
          }}
        >
          Compartilhar ano
        </Button>
      </fieldset>
      <div className="stats-root" aria-live="polite" aria-busy={busy}>
        {load.kind === 'loading' && <Skeleton label="Carregando estatísticas" rows={6} />}
        {load.kind === 'error' && (
          <EmptyState icon={<Icon name="alert" />} title={`Não foi possível carregar as estatísticas (${load.message}).`} />
        )}
        {load.kind === 'ok' && <StatsBody s={load.s} isCurrentYear={year === currentYear} />}
      </div>
    </div>
  );
}
