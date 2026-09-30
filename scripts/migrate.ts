import { authConfig, migrateDatabase } from "../src/lib/server/auth";
import { createDatabase } from "../src/lib/server/database";

const config = authConfig();
if (!config)
  throw new Error(
    "Set BETTER_AUTH_URL, BETTER_AUTH_SECRET and DATABASE_URL (or PGLITE_DATA_DIR for development) before migration",
  );
const database = await createDatabase();
try {
  await migrateDatabase(database, config);
  console.log("Authentication and project database migrations completed.");
} finally {
  await database.end();
}
