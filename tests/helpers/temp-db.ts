import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Remove diretório temporário que pode ter abrigado um SQLite em WAL.
 * No Windows, `db.close()` sem finalizar statements em cache deixa o handle preso até o GC
 * (`sqlite3_close_v2`), disparando `EBUSY` no `rmSync` imediato.
 */
export const removeTempDir = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err;
    Bun.gc(true);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
};

export const withTempDb = (prefix: string, run: (dbPath: string) => void, fileName = 'app.db'): void => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    run(join(dir, fileName));
  } finally {
    removeTempDir(dir);
  }
};
