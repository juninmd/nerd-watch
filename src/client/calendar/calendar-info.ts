import { type CalendarInfoDto, getCalendarInfo } from '../api/index.ts';
import { type AgendaEntry, entryKey } from './calendar-model.ts';

const cache = new Map<string, Promise<CalendarInfoDto | null>>();
const MAX_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];

const slot = async <T>(job: () => Promise<T>): Promise<T> => {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
};

/** Ficha sob demanda, com no máximo 2 pedidos em voo (os limites das fontes são por IP). Falha vira `null` e não fica em cache. */
export const loadInfo = (e: AgendaEntry): Promise<CalendarInfoDto | null> => {
  const key = entryKey(e);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = slot(() => getCalendarInfo(e.titleSource, e.titleSourceId, e.mediaType)).catch(() => {
    cache.delete(key);
    return null;
  });
  cache.set(key, p);
  return p;
};

/** Registra uma ficha que já veio na lista (estreias) para o detalhe não pedir de novo. */
export const seedInfo = (e: AgendaEntry, info: CalendarInfoDto): void => {
  cache.set(entryKey(e), Promise.resolve(info));
};
