import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { config, driveClientConfigured, driveConnected } from '../config.ts';
import { getDb } from '../db.ts';
import { updateEnvVar } from '../env-file.ts';
import {
  DriveFolderNotFoundError,
  getFolderName,
  listFolderVideos,
  parseFolderInput,
  streamDriveFile,
  toItems,
} from '../providers/drive/api.ts';
import { DriveNotConnectedError, DriveReauthRequiredError, completeAuthFlow, disconnectDrive, getFlowState, startAuthFlow } from '../providers/drive/oauth.ts';
import { countTelegramItemsByChannel, getTelegramItem, listTelegramItems, pruneTelegramItems, updateChannelCursor, upsertTelegramChannel, upsertTelegramItems } from '../repo/telegram.ts';
import type { TelegramChannel } from '../repo/telegram.ts';
import { toChannelResponse } from '../telegram-channel-dto.ts';
import { localizeThumbs } from '../telegram-item-thumbs.ts';

export const driveRoutes = new Hono();

const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
const CLIENT_SECRET_RE = /^[A-Za-z0-9_-]{10,120}$/;

const status = () => ({ clientConfigured: driveClientConfigured(), connected: driveConnected() });

const callbackUrl = (): string => `http://127.0.0.1:${config.port}/api/drive/oauth/callback`;

/** Erro de domínio -> resposta HTTP. Mensagens são nossas (nunca o corpo cru do Google). */
const errorResponse = (err: unknown): { status: 404 | 409 | 501 | 502; error: string } => {
  if (err instanceof DriveNotConnectedError) return { status: 501, error: err.message };
  if (err instanceof DriveReauthRequiredError) return { status: 409, error: err.message };
  if (err instanceof DriveFolderNotFoundError) return { status: 404, error: err.message };
  return { status: 502, error: 'não foi possível falar com o Google Drive agora' };
};

driveRoutes.get('/', (c) => c.json(status()));

driveRoutes.post('/settings', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; clientSecret?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'corpo inválido' }, 400);

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : undefined;
  if (clientId !== undefined && !CLIENT_ID_RE.test(clientId)) return c.json({ error: 'client ID inválido (termina em .apps.googleusercontent.com)' }, 400);
  if (clientSecret !== undefined && !CLIENT_SECRET_RE.test(clientSecret)) return c.json({ error: 'client secret inválido' }, 400);

  // Outro client ID invalida o refresh token guardado (ele pertence ao client que o emitiu).
  if (clientId !== undefined && clientId !== config.drive.clientId && config.drive.refreshToken) await disconnectDrive();
  if (clientId !== undefined) {
    updateEnvVar('GOOGLE_CLIENT_ID', clientId);
    config.drive.clientId = clientId;
  }
  if (clientSecret !== undefined) {
    updateEnvVar('GOOGLE_CLIENT_SECRET', clientSecret);
    config.drive.clientSecret = clientSecret;
  }
  return c.json(status());
});

driveRoutes.post('/oauth/start', (c) => {
  const result = startAuthFlow(callbackUrl());
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ authUrl: result.authUrl });
});

driveRoutes.get('/oauth/status', (c) => c.json({ ...getFlowState(), ...status() }));

const page = (title: string, message: string): Response =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><main style="text-align:center;padding:24px"><h1>${title}</h1><p>${message}</p></main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  );

/** O Google redireciona o navegador para cá. O `state` de uso único é o que impede um terceiro de injetar um código. */
driveRoutes.get('/oauth/callback', async (c) => {
  const result = await completeAuthFlow({ state: c.req.query('state') ?? null, code: c.req.query('code') ?? null, error: c.req.query('error') ?? null });
  return result.status === 'connected'
    ? page('Google Drive conectado', 'Pode fechar esta aba e voltar ao nerd-watch.')
    : page('Não foi possível conectar', result.status === 'error' ? result.error : 'tente novamente em Conexões.');
});

driveRoutes.post('/logout', async (c) => {
  await disconnectDrive();
  return c.json(status());
});

/** Lê a pasta no Drive, grava os vídeos (e remove os que sumiram) e baixa as miniaturas. */
export const syncDriveFolder = async (db: Database, channel: TelegramChannel, folderId: string): Promise<number> => {
  const items = toItems(await listFolderVideos(folderId));
  upsertTelegramItems(db, channel.id, items);
  pruneTelegramItems(
    db,
    channel.id,
    items.map((i) => i.messageId),
  );
  const current = listTelegramItems(db, channel.id);
  await localizeThumbs(db, channel, current);
  const oldest = current[0]?.message_id ?? null;
  if (oldest) updateChannelCursor(db, channel.id, oldest);
  return current.length;
};

driveRoutes.post('/folders', async (c) => {
  const body = await c.req.json<{ folder?: unknown }>().catch(() => null);
  const folderId = typeof body?.folder === 'string' ? parseFolderInput(body.folder) : null;
  if (!folderId) return c.json({ error: 'informe o link da pasta do Google Drive (…/drive/folders/ID) ou o ID dela' }, 400);

  const db = await getDb();
  try {
    const name = await getFolderName(folderId);
    const channel = upsertTelegramChannel(db, { handle: folderId, mode: 'drive', displayName: name });
    await syncDriveFolder(db, channel, folderId);
    return c.json(toChannelResponse(channel, countTelegramItemsByChannel(db).get(channel.id) ?? 0), 201);
  } catch (err) {
    const { status: code, error } = errorResponse(err);
    return c.json({ error }, code);
  }
});

/** Usada pela rota de atualização dos canais (`POST /api/telegram/channels/:id/refresh`). */
export const refreshDriveChannel = async (db: Database, channel: TelegramChannel): Promise<{ itemCount: number } | { status: 404 | 409 | 501 | 502; error: string }> => {
  try {
    return { itemCount: await syncDriveFolder(db, channel, channel.handle) };
  } catch (err) {
    return errorResponse(err);
  }
};

const FILE_REF_RE = /^[A-Za-z0-9_-]{10,100}$/;

/** Usada pela rota de reprodução (`GET …/items/:messageId/play`): proxy com Range, o token fica no servidor. */
export const playDriveItem = async (db: Database, channel: TelegramChannel, messageId: string, range: string | undefined): Promise<Response> => {
  const item = getTelegramItem(db, channel.id, messageId);
  if (!item?.file_ref || !FILE_REF_RE.test(item.file_ref)) return Response.json({ error: 'vídeo não encontrado nessa pasta' }, { status: 404 });
  try {
    return await streamDriveFile(item.file_ref, range);
  } catch (err) {
    const { status: code, error } = errorResponse(err);
    return Response.json({ error }, { status: code });
  }
};
