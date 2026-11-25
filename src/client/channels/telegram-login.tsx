import { Button, Stepper } from '@juninmd/sonido';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelTelegramLogin, getTelegramLoginStatus, getTelegramSettings, logoutTelegram, startTelegramLogin, type TelegramLoginState, type TelegramPersonalAccount } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { ConnCard, type ConnStatus } from '../connections/conn-card.tsx';
import { Icon } from '../ui/icon.tsx';
import { CancelButton, ConnectedStep, CredentialsStep, ErrorStep, PasswordStep, QrStep, SessionEndedAlert } from './telegram-login-steps.tsx';

const WAS_CONNECTED_KEY = 'nw.telegram.wasConnected';
const STEPS = [{ label: 'Credenciais' }, { label: 'Escanear' }, { label: 'Verificação' }, { label: 'Pronto' }];

const remember = (connected: boolean): void => {
  try {
    if (connected) localStorage.setItem(WAS_CONNECTED_KEY, '1');
    else localStorage.removeItem(WAS_CONNECTED_KEY);
  } catch {
    // armazenamento bloqueado: o aviso de sessão expirada simplesmente não aparece
  }
};

const wasConnected = (): boolean => {
  try {
    return localStorage.getItem(WAS_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Avisa o resto do app (pílula da barra superior, paleta) que o estado da conexão mudou. */
const announce = (): void => {
  window.dispatchEvent(new Event('nw:connection-changed'));
};

type Stage =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'credentials' }
  | { kind: 'ready' }
  | { kind: 'connecting' }
  | { kind: 'qr'; dataUrl: string; expiresAt: number }
  | { kind: 'password'; hint: string }
  | { kind: 'error'; message: string }
  | { kind: 'connected'; account: TelegramPersonalAccount | null };

const STEP_OF: Record<Stage['kind'], number> = {
  loading: 0,
  unavailable: 0,
  credentials: 0,
  ready: 1,
  connecting: 1,
  qr: 1,
  password: 2,
  error: 1,
  connected: 4,
};

/** Cartão do Telegram em Conexões: etapas guiadas de login por QR code (credenciais → QR → 2FA → pronto). */
export function TelegramLogin() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [status, setStatus] = useState<ConnStatus>({ ok: false, label: 'verificando…' });
  const [starting, setStarting] = useState(false);
  // Cada stop() invalida fetches e timers em voo de um ciclo anterior (ex.: "cancelar" clicado enquanto uma resposta
  // pendente ainda ia desenhar o QR por cima de um estado mais novo).
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrToken = useRef<string | null>(null);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const showState = (state: TelegramLoginState, gen: number): void => {
    if (gen !== generation.current) return;
    if (state.status === 'pending') {
      if (!state.token) {
        setStage({ kind: 'connecting' });
        return;
      }
      const expiresAt = state.expires;
      if (qrToken.current === state.token) {
        setStage((s) => (s.kind === 'qr' ? { ...s, expiresAt } : s));
        return;
      }
      qrToken.current = state.token;
      void QRCode.toDataURL(`tg://login?token=${state.token}`, { margin: 1, width: 232 }).then((dataUrl) => {
        if (gen === generation.current) setStage({ kind: 'qr', dataUrl, expiresAt });
      });
    } else if (state.status === 'need_password') {
      setStage((s) => (s.kind === 'password' ? s : { kind: 'password', hint: state.hint }));
    } else if (state.status === 'success') {
      stop();
      showToast('Telegram conectado');
      announce();
      refresh();
    } else if (state.status === 'error') {
      stop();
      setStage({ kind: 'error', message: state.message });
    }
  };

  const poll = (gen: number): void => {
    if (gen !== generation.current) return;
    getTelegramLoginStatus()
      .then((state) => {
        if (gen !== generation.current) return;
        showState(state, gen);
        if (gen === generation.current && (state.status === 'pending' || state.status === 'need_password')) timer.current = setTimeout(() => poll(gen), 1500);
      })
      .catch(() => {
        if (gen === generation.current) timer.current = setTimeout(() => poll(gen), 3000);
      });
  };

  const refresh = (): void => {
    // Respostas que chegam depois de sair da tela (ex.: "cancelar") não podem religar o polling.
    if (!mounted.current) return;
    stop();
    qrToken.current = null;
    const gen = generation.current;
    getTelegramSettings(true)
      .then((s) => {
        if (gen !== generation.current) return;
        setStatus({
          ok: s.personalConfigured,
          label: s.personalConfigured ? 'conectado' : s.apiCredentialsConfigured ? 'desconectado' : 'não configurado',
        });
        if (s.personalConfigured) {
          remember(true);
          return setStage({ kind: 'connected', account: s.personalAccount });
        }
        if (wasConnected()) announce();
        if (!s.apiCredentialsConfigured) return setStage({ kind: 'credentials' });
        // Voltar à página no meio de um login: retoma o QR em vez de oferecer "entrar" (que falharia com "já em andamento").
        return getTelegramLoginStatus().then((state) => {
          if (gen !== generation.current) return;
          if (state.status === 'pending' || state.status === 'need_password') poll(gen);
          else setStage({ kind: 'ready' });
        });
      })
      .catch(() => {
        if (gen === generation.current) setStage({ kind: 'unavailable' });
      });
  };

  // Roda uma vez por montagem; sair da tela para o polling.
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  const startLogin = () => {
    setStarting(true);
    const gen = generation.current;
    startTelegramLogin()
      .then(() => {
        if (gen === generation.current) poll(gen);
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'não foi possível iniciar o login'))
      .finally(() => setStarting(false));
  };

  const cancel = () => {
    stop();
    void cancelTelegramLogin().finally(refresh);
  };

  const logout = (): Promise<void> => {
    remember(false);
    return logoutTelegram().then(
      () => {
        showToast('sessão encerrada');
        announce();
        refresh();
      },
      (err: unknown) => {
        showToast('não foi possível encerrar a sessão');
        throw err;
      },
    );
  };

  const endedAlert = wasConnected() && <SessionEndedAlert />;
  const body = (() => {
    switch (stage.kind) {
      case 'loading':
        return <p className="hint">consultando o Telegram…</p>;
      case 'unavailable':
        return <p className="hint">não foi possível consultar o Telegram agora</p>;
      case 'credentials':
        return (
          <>
            {endedAlert}
            <CredentialsStep onSaved={refresh} />
          </>
        );
      case 'ready':
        return (
          <>
            {endedAlert}
            <p className="hint">Entrar leva um minuto: você escaneia um QR code com o app do Telegram no celular. O app nunca vê seu telefone nem o código de SMS.</p>
            <Button variant="primary" iconStart={<Icon name="send" size="sm" />} loading={starting} onClick={startLogin}>
              Entrar com QR code
            </Button>
          </>
        );
      case 'connecting':
        return (
          <>
            <p className="hint" role="status">
              Conectando ao Telegram… (até 30 s)
            </p>
            <CancelButton onCancel={cancel} />
          </>
        );
      case 'qr':
        return <QrStep dataUrl={stage.dataUrl} expiresAt={stage.expiresAt} onCancel={cancel} />;
      case 'password':
        return <PasswordStep hint={stage.hint} onCancel={cancel} />;
      case 'error':
        return <ErrorStep message={stage.message} onRetry={refresh} onFix={() => setStage({ kind: 'credentials' })} />;
      case 'connected':
        return <ConnectedStep account={stage.account} onImport={() => navigate('/telegram?import=1')} onLogout={logout} />;
    }
  })();

  const showSteps = stage.kind !== 'loading' && stage.kind !== 'unavailable';
  return (
    <ConnCard id="conn-telegram" wide icon="send" title="Telegram" description="Assista aos vídeos dos seus canais aqui dentro, sem baixar nada." status={status}>
      {showSteps && <Stepper className="tg-steps" steps={STEPS} current={STEP_OF[stage.kind]} />}
      {body}
    </ConnCard>
  );
}
