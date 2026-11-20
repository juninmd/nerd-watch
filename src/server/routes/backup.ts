import { Hono } from 'hono';
import { getDb } from '../db/database.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';
import { InvalidBackupError, exportBackup, importBackup, validateBackup } from '../repo/backup.ts';

/** Backups grandes (milhares de títulos e episódios) cabem com folga em 25 MB sem abrir espaço para OOM. */
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;

export const backupRoutes = new Hono();

backupRoutes.get('/', async (c) => {
  const backup = exportBackup(await getDb());
  c.header('Content-Disposition', `attachment; filename="nerd-watch-backup-${backup.exportedAt.slice(0, 10)}.json"`);
  c.header('Cache-Control', 'no-store');
  return c.json(backup);
});

backupRoutes.post('/import', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c, BACKUP_MAX_BYTES);
    try {
      const data = validateBackup(body);
      const imported = importBackup(await getDb(), data);
      return c.json({ imported });
    } catch (err) {
      if (err instanceof InvalidBackupError) return c.json({ error: err.message }, 400);
      return c.json({ error: 'falha ao importar backup (dados inconsistentes com o schema atual?)' }, 400);
    }
  }),
);
