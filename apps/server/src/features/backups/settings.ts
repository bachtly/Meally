export interface BackupSettings {
  hours: number;
  keep: number;
}
/** Read-only schedule from the environment. 0 hours means scheduled backups are off. */
export function backupSettings(env: Record<string, string | undefined>): BackupSettings {
  const h = Number(env.MEALLY_BACKUP_CRON_HOURS ?? 24);
  const k = Number(env.MEALLY_BACKUP_KEEP ?? 7);
  return { hours: Number.isFinite(h) && h > 0 ? h : 0, keep: Number.isInteger(k) && k >= 1 ? k : 7 };
}
