import { spawnSync } from "node:child_process";

function run(args, timeout) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", timeout });
  if (result.error || result.status !== 0) {
    process.stderr.write("Patchsentry deployment preparation failed. Production was not replaced.\n");
    process.exit(result.status || 1);
  }
}

// Sensitive production variables stay inside Vercel. Prepare the schema there,
// before publishing code that depends on it. Preview builds never touch it.
if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) {
    process.stderr.write("Production deployment requires database and authentication configuration.\n");
    process.exit(1);
  }
  run(["--import", "tsx", "scripts/migrate.ts"], 120000);
}
run(["node_modules/next/dist/bin/next", "build"], 600000);
