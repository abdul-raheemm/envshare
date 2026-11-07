import { prisma } from "@/lib/db";

export function assertTestDatabase() {
  const name = new URL(process.env.DATABASE_URL ?? "").pathname.replace("/", "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run: "${name}" is not a test database`);
  }
}

export async function blockInserts(table: string) {
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION sweep_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'blocked by security sweep'; END; $$ LANGUAGE plpgsql`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER sweep_block BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION sweep_block()`
  );
}

export async function unblockInserts(table: string) {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sweep_block ON "${table}"`);
}

export async function resetDb() {
  assertTestDatabase();
  await unblockInserts("HistoryEntry");
  await unblockInserts("RevealLog");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "RevealLog","HistoryEntry","Variable","Environment","ProjectMember","Project","User" RESTART IDENTITY CASCADE`
  );
}

export async function seedWorld() {
  const mk = (name: string) =>
    prisma.user.create({
      data: { email: `${name}@test.local`, name, passwordHash: "not-a-real-hash" },
    });
  const alice = await mk("alice");
  const bob = await mk("bob");
  const mallory = await mk("mallory");

  const project = await prisma.project.create({
    data: {
      name: "Shared project",
      ownerId: alice.id,
      members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      environments: { create: [{ name: "Development" }, { name: "Staging" }] },
    },
    include: { environments: true },
  });
  // Mallory is a real user with her own project, but not a member of the shared one
  await prisma.project.create({
    data: {
      name: "Mallory's project",
      ownerId: mallory.id,
      members: { create: [{ userId: mallory.id }] },
      environments: { create: [{ name: "Development" }] },
    },
  });

  const dev = project.environments.find((e) => e.name === "Development")!;
  const staging = project.environments.find((e) => e.name === "Staging")!;
  return { alice, bob, mallory, project, dev, staging };
}

export type World = Awaited<ReturnType<typeof seedWorld>>;

// Returns the HTTP-style status of an ApiError, or "ok" if the call succeeded
export async function statusOf(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const x = e as { status?: number; statusCode?: number };
    return x.status ?? x.statusCode ?? -1;
  }
}

// Scans every text column of every table for a string. Returns "table.column" hits.
export async function dbHits(needle: string): Promise<string[]> {
  const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
      AND table_name <> '_prisma_migrations'`;
  const hits: string[] = [];
  for (const c of cols) {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}" LIKE $1`,
      `%${needle}%`
    );
    if (rows[0].n > 0) hits.push(`${c.table_name}.${c.column_name}`);
  }
  return hits;
}

export function flip(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[0] ^= 0xff;
  return buf.toString("base64");
}