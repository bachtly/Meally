// Stores the jobs secret and project URL in Vault, then applies supabase/cron.sql over the pooler.
// Env: DB_URL (connection string incl. password), SUPABASE_PROJECT_REF, JOB_SECRET. Prints nothing secret.
import fs from "node:fs";
import postgres from "postgres";

const { DB_URL, SUPABASE_PROJECT_REF: ref, JOB_SECRET: secret } = process.env;
if (!DB_URL || !ref || !secret) throw new Error("DB_URL, SUPABASE_PROJECT_REF and JOB_SECRET are required");
const sql = postgres(DB_URL, { prepare: false, max: 1, onnotice: () => {} });
try {
  const put = async (name, value) => {
    await sql`delete from vault.secrets where name = ${name}`;
    await sql`select vault.create_secret(${value}, ${name})`;
  };
  await put("meally_project_url", `https://${ref}.supabase.co`);
  await put("meally_jobs_secret", secret);
  await sql.unsafe(fs.readFileSync(new URL("../supabase/cron.sql", import.meta.url), "utf8"));
  console.log("cron schedules applied");
} finally {
  await sql.end();
}
