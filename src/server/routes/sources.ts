import { Hono } from 'hono';
import { config } from '../config.ts';
import { getDb } from '../db.ts';
import { getDescriptor, getSource, listDescriptors } from '../providers/sources/registry.ts';
import { sourceErrorBody, syncSourceChannel } from '../providers/sources/service.ts';
import { readSetting, writeSetting } from '../providers/sources/settings.ts';
import type { SourceDescriptor } from '../providers/sources/types.ts';
import { countTelegramItemsByChannel, deleteTelegramChannel, getTelegramChannelByHandle, upsertTelegramChannel } from '../repo/telegram.ts';
import { toChannelResponse } from '../telegram-channel-dto.ts';

export const sourcesRoutes = new Hono();

const redirectUri = (d: SourceDescriptor): string => `http://${d.redirectHost ?? '127.0.0.1'}:${config.port}/api/sources/${d.id}/oauth/callback`;

/** Estado para a UI. Segredos nunca saem daqui: só `set: true`. */
const toDto = (d: SourceDescriptor) => ({
  id: d.id,
  title: d.title,
  description: d.description,
  icon: d.icon,
  ownCard: Boolean(d.ownCard),
  guide: d.guide && { summary: d.guide.summary, steps: d.guide.steps.map((step) => step.replaceAll('{{redirectUri}}', redirectUri(d))) },
  fields: d.fields.map((f) => ({
    key: f.key,
    label: f.label,
    secret: Boolean(f.secret),
    placeholder: f.placeholder ?? '',
    required: Boolean(f.required),
    readOnly: Boolean(f.readOnly),
    set: Boolean(readSetting(f.env)),
    value: f.secret ? '' : (readSetting(f.env) ?? ''),
  })),
  configured: d.configured(),
  connected: d.connected(),
  oauth: Boolean(d.oauth),
  redirectUri: d.oauth ? redirectUri(d) : null,
  add: d.add ?? null,
});

sourcesRoutes.get('/', (c) => c.json({ sources: listDescriptors().map(toDto) }));

sourcesRoutes.post('/:id/settings', async (c) => {
  const descriptor = getDescriptor(c.req.param('id'));
  if (!descriptor) return c.json({ error: 'fonte desconhecida' }, 404);
  const body = await c.req.json<{ values?: unknown }>().catch(() => null);
  const values = body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return c.json({ error: 'corpo inválido' }, 400);

  // Valida tudo antes de gravar qualquer coisa: salvar pela metade deixaria a fonte inconsistente.
  const changes: { env: string; key: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const field = descriptor.fields.find((f) => f.key === key);
    if (!field || typeof raw !== 'string') return c.json({ error: `campo inválido: ${key}` }, 400);
    // Qualquer página em loopback (outra porta) passa pela checagem de Origin: o que amplia acesso ao disco só muda no `.env`.
    if (field.readOnly) return c.json({ error: `${field.label}: por segurança só pode ser alterado no arquivo .env (${field.env})` }, 403);
    const value = raw.trim();
    if (/[\r\n]/.test(value)) return c.json({ error: `${field.label}: não pode conter quebra de linha` }, 400);
    const problem = value ? field.validate?.(value) : null;
    if (problem) return c.json({ error: `${field.label}: ${problem}` }, 400);
    changes.push({ env: field.env, key, value });
  }

  const changed = changes.filter((ch) => (readSetting(ch.env) ?? '') !== ch.value);
  // Outro client ID invalida o refresh token guardado (ele pertence ao client que o emitiu).
  if (descriptor.oauth && changed.some((ch) => ch.env === descriptor.oauth?.spec.clientIdEnv) && descriptor.oauth.connected()) await descriptor.oauth.disconnect();
  for (const ch of changed) writeSetting(ch.env, ch.value);
  await descriptor.onSettingsChanged?.(changed.map((ch) => ch.key));
  return c.json(toDto(descriptor));
});

sourcesRoutes.post('/:id/oauth/start', (c) => {
  const descriptor = getDescriptor(c.req.param('id'));
  if (!descriptor?.oauth) return c.json({ error: 'fonte sem OAuth' }, 404);
  const result = descriptor.oauth.start(redirectUri(descriptor));
  return result.ok ? c.json({ authUrl: result.authUrl }) : c.json({ error: result.error }, 400);
});

sourcesRoutes.get('/:id/oauth/status', (c) => {
  const descriptor = getDescriptor(c.req.param('id'));
  if (!descriptor?.oauth) return c.json({ error: 'fonte sem OAuth' }, 404);
  return c.json({ ...descriptor.oauth.state(), configured: descriptor.configured(), connected: descriptor.connected() });
});

const page = (title: string, message: string): Response =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><main style="text-align:center;padding:24px"><h1>${title}</h1><p>${message}</p></main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  );

/** O serviço redireciona o navegador para cá. O `state` de uso único é o que impede um terceiro de injetar um código. */
sourcesRoutes.get('/:id/oauth/callback', async (c) => {
  const descriptor = getDescriptor(c.req.param('id'));
  if (!descriptor?.oauth) return page('Fonte desconhecida', 'volte ao nerd-watch.');
  const result = await descriptor.oauth.complete({ state: c.req.query('state') ?? null, code: c.req.query('code') ?? null, error: c.req.query('error') ?? null });
  return result.status === 'connected'
    ? page(`${descriptor.title} conectado`, 'Pode fechar esta aba e voltar ao nerd-watch.')
    : page('Não foi possível conectar', result.status === 'error' ? result.error : 'tente novamente em Conexões.');
});

sourcesRoutes.post('/:id/oauth/disconnect', async (c) => {
  const descriptor = getDescriptor(c.req.param('id'));
  if (!descriptor?.oauth) return c.json({ error: 'fonte sem OAuth' }, 404);
  await descriptor.oauth.disconnect();
  return c.json(toDto(descriptor));
});

/** Cria (ou reaproveita) o canal da fonte e já importa os vídeos. Se a primeira leitura falha, o canal recém-criado não fica vazio no catálogo. */
sourcesRoutes.post('/:mode/channels', async (c) => {
  const source = getSource(c.req.param('mode'));
  if (!source) return c.json({ error: 'fonte desconhecida' }, 404);
  const body = await c.req.json<{ input?: unknown }>().catch(() => null);
  const input = typeof body?.input === 'string' ? body.input.trim() : '';
  if (!input) return c.json({ error: 'informe o que adicionar' }, 400);

  const db = await getDb();
  let createdId: string | null = null;
  try {
    const { handle, name } = await source.resolve(input);
    const existed = getTelegramChannelByHandle(db, handle);
    const channel = upsertTelegramChannel(db, { handle, mode: source.mode, displayName: name });
    if (!existed) createdId = channel.id;
    await syncSourceChannel(db, channel);
    return c.json(toChannelResponse(channel, countTelegramItemsByChannel(db).get(channel.id) ?? 0), 201);
  } catch (err) {
    if (createdId) deleteTelegramChannel(db, createdId);
    const { status, error } = sourceErrorBody(err);
    return c.json({ error }, status);
  }
});
