import type { Database } from 'bun:sqlite';
import { todayIso } from '../date.ts';
import { listUpcoming } from '../repo/calendar.ts';
import { markNotificationSent, sentKeys } from '../repo/notifications.ts';
import { buildMessage } from './message.ts';
import { dueNotifications, notificationKey } from './due.ts';
import type { NotifySink } from './sinks.ts';

/** Tentativas por aviso neste processo antes de desistir até o próximo boot. Evita retry sem fim num sink quebrado. */
export const MAX_ATTEMPTS = 3;

export interface NotifyTickDeps {
  db: Database;
  sinks: readonly NotifySink[];
  leadDays: number;
  now: () => Date;
  /** Falhas por chave, vivas enquanto o agendador rodar (estado de processo, não de banco). */
  attempts: Map<string, number>;
  maxAttempts?: number;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface NotifyTickResult {
  notified: number;
  failed: number;
}

/**
 * Um ciclo: envia cada aviso devido a todos os sinks em paralelo. Marca como enviado só se ao menos um sink
 * aceitou; se todos falharem, a chave fica de fora da marcação e volta no próximo ciclo (até `maxAttempts`).
 * Falha de um sink nunca impede o outro, e nenhuma falha sai daqui: o agendador não pode morrer por isso.
 */
export const runNotifyTick = async (deps: NotifyTickDeps): Promise<NotifyTickResult> => {
  const result: NotifyTickResult = { notified: 0, failed: 0 };
  if (deps.sinks.length === 0) return result;

  const now = deps.now();
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const signal = deps.signal ?? new AbortController().signal;
  const entries = listUpcoming(deps.db, deps.leadDays, todayIso(now));
  const alreadySent = sentKeys(deps.db, entries.map(notificationKey));
  const due = dueNotifications(entries, now, deps.leadDays, alreadySent);

  for (const { key, entry, daysUntil } of due) {
    const attempts = deps.attempts.get(key) ?? 0;
    if (attempts >= maxAttempts) continue;

    const message = buildMessage(entry, daysUntil);
    const outcomes = await Promise.allSettled(deps.sinks.map((sink) => sink.send(message, signal)));

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') deps.log(`[notify] envio falhou: ${describe(outcome.reason)}`);
    }

    if (outcomes.some((outcome) => outcome.status === 'fulfilled')) {
      markNotificationSent(deps.db, key, now.toISOString());
      deps.attempts.delete(key);
      result.notified += 1;
    } else {
      deps.attempts.set(key, attempts + 1);
      result.failed += 1;
      deps.log(`[notify] ${key} não entregue (tentativa ${attempts + 1} de ${maxAttempts})`);
    }
  }

  return result;
};

/** Só a mensagem dos nossos erros (já sem URL). Qualquer outra exceção vira um rótulo genérico. */
const describe = (reason: unknown): string => (reason instanceof Error && reason.name === 'SinkError' ? reason.message : 'erro inesperado');
