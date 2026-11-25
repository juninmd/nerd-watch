/**
 * Casca do app em React com os componentes do Sonido: menu lateral (NavRail), barra superior e rodapé do menu.
 * A tela atual vem do store (`page`); `main.ts` resolve a rota e faz a troca dentro da transição de tela.
 */
import { Avatar, Badge, Button, Kbd, NavRail, ToastProvider } from '@juninmd/sonido';
import { Fragment, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PlayerDock } from '../player/player-dock-bar.tsx';
import { Icon } from '../ui/icon.tsx';
import { OverlayHost } from '../ui/overlay.tsx';
import { ToastBridge } from '../ui/toast-bridge.tsx';
import { isNavActive, NAV_GROUPS } from './nav-model.ts';
import { connectionLabel, type ShellStore } from './shell-store.ts';
import { THEME_LABEL } from './theme.ts';

const THEME_ICON = { dark: 'moon', light: 'sun', system: 'monitor' } as const;

export interface ShellActions {
  navigate: (path: string) => void;
  toggleCompact: () => void;
  setDrawer: (open: boolean) => void;
  toggleTheme: () => void;
  logout: () => void;
  openPalette: () => void;
  copyLink: () => void;
}

export interface ShellOptions {
  store: ShellStore;
  actions: ShellActions;
  paletteKey: string;
  canShare: boolean;
}

const GROUPS = NAV_GROUPS.map((g) => ({
  title: g.label,
  items: g.items.map((it) => ({ key: it.path, label: it.label, icon: <Icon name={it.icon} /> })),
}));

const activeKey = (path: string): string =>
  NAV_GROUPS.flatMap((g) => g.items).find((it) => isNavActive(it, path))?.path ?? '';

function Shell({ store, actions, paletteKey, canShare }: ShellOptions) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const label = connectionLabel(s.connected, s.account);
  const compactLabel = s.compact ? 'Expandir menu' : 'Recolher menu';
  return (
    <ToastProvider>
      <ToastBridge />
      <a className="skip" href="#view">
        pular para o conteúdo
      </a>
      <div className={`shell${s.compact ? ' nav-compact' : ''}`}>
        <aside className={`navrail${s.drawerOpen ? ' is-open' : ''}`} id="sidebar" aria-label="menu lateral">
          <NavRail
            label="principal"
            compact={s.compact}
            groups={GROUPS}
            value={activeKey(s.activePath)}
            onChange={actions.navigate}
            brand={
              <span className="side-brand">
                <span className="brand" aria-hidden="true">
                  <Icon name="film" />
                </span>
                <span className="brand-name">nerd-watch</span>
                <Button
                  className="nav-collapse"
                  variant="ghost"
                  size="icon"
                  aria-pressed={s.compact}
                  aria-label={compactLabel}
                  onClick={actions.toggleCompact}
                >
                  <Icon name="panel" size="sm" />
                </Button>
              </span>
            }
          />
          <div className="side-foot">
            <Button
              variant="secondary"
              size="sm"
              iconStart={<Icon name={THEME_ICON[s.theme]} size="sm" />}
              iconEnd={<Kbd>v</Kbd>}
              aria-label={`Tema: ${THEME_LABEL[s.theme]}. Alternar tema`}
              onClick={actions.toggleTheme}
            >
              <span className="side-label">Tema: {THEME_LABEL[s.theme]}</span>
            </Button>
            {s.showLogout && (
              <Button variant="secondary" size="sm" iconStart={<Icon name="logout" size="sm" />} onClick={actions.logout}>
                <span className="side-label">Sair</span>
              </Button>
            )}
          </div>
        </aside>
        {s.drawerOpen && <div className="drawer-scrim" onClick={() => actions.setDrawer(false)} aria-hidden="true" />}
        <div className="main">
          <header className="topbar">
            <Button
              className="menu-btn"
              variant="secondary"
              size="icon"
              aria-controls="sidebar"
              aria-expanded={s.drawerOpen}
              aria-label="Abrir menu"
              onClick={() => actions.setDrawer(!s.drawerOpen)}
            >
              <Icon name="menu" />
            </Button>
            <Button
              className="cmd"
              variant="secondary"
              aria-haspopup="dialog"
              iconStart={<Icon name="search" />}
              iconEnd={<Kbd>{paletteKey}</Kbd>}
              onClick={actions.openPalette}
            >
              <span className="cmd-text">Buscar títulos, canais e ações…</span>
            </Button>
            {canShare && (
              <Button
                variant="secondary"
                size="sm"
                iconStart={<Icon name="link" size="sm" />}
                aria-label="Copiar link desta tela"
                title="Copiar link desta tela"
                onClick={actions.copyLink}
              >
                <span className="pill-label">link</span>
              </Button>
            )}
            <a className="conn-link" href="#/connections" aria-label={label}>
              {s.connected && s.account?.avatarUrl && <Avatar name={s.account.name} src={s.account.avatarUrl} size={20} />}
              <Badge dot tone={s.connected ? 'success' : 'neutral'}>
                <span className="pill-label">{label}</span>
              </Badge>
            </a>
          </header>
          <main id="view" tabIndex={-1}>
            <Fragment key={s.routeKey}>{s.page}</Fragment>
          </main>
          <div id="route-announcer" className="sr-only" aria-live="polite" />
        </div>
      </div>
      <PlayerDock />
      <OverlayHost />
    </ToastProvider>
  );
}

/** Desenha a casca de forma síncrona: quando volta, `#view` e a barra do player (com o `<video>`) já existem no DOM. */
export const mountShell = (host: HTMLElement, options: ShellOptions): void => {
  const root = createRoot(host);
  flushSync(() => root.render(<Shell {...options} />));
};

/** Aplica uma mudança no store já desenhada: precisa ser síncrona dentro da transição de tela (destaque do menu). */
export const commitShell = (store: ShellStore, patch: Parameters<ShellStore['set']>[0]): void => {
  flushSync(() => store.set(patch));
};
