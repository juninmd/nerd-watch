/** "21:34 · termina 22:51": hora atual e quando o vídeo acaba na velocidade escolhida. Sem DOM. */
const hhmm = (d: Date): string => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const clockLabel = (now: Date, current: number, duration: number, rate: number): string => {
  if (!Number.isFinite(duration) || duration <= 0 || current >= duration) return hhmm(now);
  const left = (duration - Math.max(0, current)) / (rate > 0 ? rate : 1);
  return `${hhmm(now)} · termina ${hhmm(new Date(now.getTime() + left * 1000))}`;
};
