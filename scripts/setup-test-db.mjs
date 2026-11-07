import { spawnSync } from "node:child_process";
import pg from "pg";

process.loadEnvFile(".env");

const devUrl = new URL(process.env.DATABASE_URL);
const devName = devUrl.pathname.replace("/", "");
const testName = "envshare_test";
if (devName === testName) {
  console.error("DATABASE_URL already points at the test database. Aborting.");
  process.exit(1);
}

const testUrl = new URL(devUrl);
testUrl.pathname = `/${testName}`;

const admin = new pg.Client({ connectionString: devUrl.toString() });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [testName]);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${testName}"`);
  console.log(`Created database ${testName}`);
}
await admin.end();

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
});
process.exit(result.status ?? 1);