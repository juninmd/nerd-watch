import { Badge, Button, Card, RadioGroup } from '@juninmd/sonido';
import { type ReactNode, useEffect, useState } from 'react';
import { type HealthResponse, health } from '../api/index.ts';
import { resolveVersionStatus, type VersionStatus } from '../platform/version-info.ts';
import { Icon } from '../ui/icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { logout } from './logout.ts';
import { notifySummary } from './settings-model.ts';
import { openShortcutHelp } from './shortcuts.ts';
import { getThemePref, onThemeChange, setThemePref, THEME_LABEL, THEME_PREFS, type ThemePref } from './theme.ts';

/** Cabeçalho comum dos cartões: ícone, título e a frase de estado; `badge` fica à direita. */
function SectionHead({ icon, title, text, badge }: { icon: IconName; title: string; text: ReactNode; badge?: ReactNode }) {
  return (
    <div className="conn-head">
      <span className="conn-ic">
        <Icon name={icon} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {badge}
    </div>
  );
}

function ThemeCard() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  // O botão de tema da barra superior também muda a preferência: o cartão acompanha.
  useEffect(() => onThemeChange(setPref), []);
  return (
    <Card padding="md">
      <SectionHead icon="moon" title="Tema" text='Escuro é o padrão. "Sistema" acompanha o seu aparelho.' />
      <RadioGroup
        label="Tema"
        options={THEME_PREFS.map((p) => ({ value: p, label: THEME_LABEL[p] }))}
        value={pref}
        onChange={setThemePref}
      />
    </Card>
  );
}

function NotifyCard({ status }: { status: HealthResponse | null | 'error' }) {
  const ready = status !== null && status !== 'error';
  const text =
    status === null ? 'Consultando o servidor…' : status === 'error' ? 'Não foi possível consultar o servidor.' : notifySummary(status.notifyEnabled, status.notifyLeadDays);
  const badge = ready ? (
    <Badge tone={status.notifyEnabled ? 'success' : 'neutral'} dot>
      {status.notifyEnabled ? 'ligados' : 'desligados'}
    </Badge>
  ) : undefined;
  return (
    <Card padding="md">
      <SectionHead icon="bell" title="Avisos de lançamento" text={text} badge={badge} />
      <p className="hint">
        Os destinos ficam no <code>.env</code>, nunca no navegador: edite em <a href="#/credentials">Credenciais</a> ou direto no arquivo. A
        antecedência (0 a 7 dias) só pelo <code>.env</code>: <code>NOTIFY_WEBHOOK_URL</code>, <code>NOTIFY_NTFY_URL</code>,{' '}
        <code>NOTIFY_DISCORD_WEBHOOK_URL</code>, <code>NOTIFY_TELEGRAM_*</code> e <code>NOTIFY_LEAD_DAYS</code>. Detalhes em
        docs/providers/notifications.md.
      </p>
    </Card>
  );
}

function VersionCard() {
  const [status, setStatus] = useState<VersionStatus | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    resolveVersionStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);

  const latest = status !== 'loading' && status ? status.latest : null;
  const text =
    status === 'loading'
      ? 'Consultando versão…'
      : status === null
        ? 'Versão indisponível neste momento.'
        : `${status.installed ? 'Versão instalada' : 'Versão do servidor'}: v${status.version}${latest ? ` · disponível: v${latest.version}` : ''}`;
  return (
    <Card padding="md">
      <SectionHead icon="download" title="Versão do app" text={text} badge={latest ? <Badge tone="accent">Nova v{latest.version}</Badge> : undefined} />
      {latest && (
        <div className="sn-card__footer">
          {/* Link, não botão: o desktop abre `a[href]` externo no navegador do sistema. Sonido Button não aceita href. */}
          <a className="sn-button sn-button--primary sn-button--md" href={latest.url} target="_blank" rel="noopener noreferrer">
            <Icon name="download" size="sm" />
            <span className="sn-button__label">Baixar v{latest.version}</span>
          </a>
        </div>
      )}
    </Card>
  );
}

function SessionCard() {
  const [busy, setBusy] = useState(false);
  const exit = (): void => {
    setBusy(true);
    void logout().finally(() => setBusy(false));
  };
  return (
    <Card padding="md">
      <SectionHead icon="shield" title="Acesso por token" text="Este servidor pede login. Sair encerra a sessão em todos os aparelhos." />
      <div className="sn-card__footer">
        <Button variant="ghost" iconStart={<Icon name="logout" size="sm" />} loading={busy} onClick={exit}>
          Sair
        </Button>
      </div>
    </Card>
  );
}

/** Ajustes e avisos: aparência, atalhos, estado dos avisos de lançamento e sessão. */
export function SettingsPage() {
  const [status, setStatus] = useState<HealthResponse | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    health()
      .then((h) => alive && setStatus(h))
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <header className="view-head">
        <h1 className="view-title">Ajustes e avisos</h1>
        <p className="view-subtitle">Aparência, atalhos e o estado dos avisos de lançamento.</p>
      </header>
      <div className="conn-grid">
        <ThemeCard />
        <Card padding="md">
          <SectionHead icon="keyboard" title="Atalhos de teclado" text="Ctrl K abre a paleta; g + letra vai a uma tela; ? lista todos." />
          <div className="sn-card__footer">
            <Button variant="ghost" iconStart={<Icon name="keyboard" size="sm" />} onClick={openShortcutHelp}>
              Ver atalhos
            </Button>
          </div>
        </Card>
        <NotifyCard status={status} />
        <VersionCard />
        {status !== null && status !== 'error' && status.accessEnabled && <SessionCard />}
      </div>
    </div>
  );
}
