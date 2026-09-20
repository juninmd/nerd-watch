import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { InvalidBackupError, exportBackup, importBackup, validateBackup } from '../repo/backup.ts';

export const backupRoutes = new Hono();

backupRoutes.get('/', async (c) => {
  const backup = exportBackup(await getDb());
  c.header('Content-Disposition', `attachment; filename="nerd-watch-backup-${backup.exportedAt.slice(0, 10)}.json"`);
  return c.json(backup);
});

backupRoutes.post('/import', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'corpo inválido: esperado JSON' }, 400);
  try {
    const data = validateBackup(body);
    const imported = importBackup(await getDb(), data);
    return c.json({ imported });
  } catch (err) {
    if (err instanceof InvalidBackupError) return c.json({ error: err.message }, 400);
    return c.json({ error: 'falha ao importar backup (dados inconsistentes com o schema atual?)' }, 400);
  }
});
