import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { encrypt } from "../src/lib/crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set (see .env.example)");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Demo accounts only. Never use this password for anything real.
const DEMO_PASSWORD = "password123";

// A value as it sits in the database. iv is non-null if and only if value is encrypted.
type Stored = { value: string; iv: string | null; authTag: string | null };
const plain = (value: string): Stored => ({ value, iv: null, authTag: null });

type Change = {
  action: "CREATE" | "UPDATE" | "DELETE" | "TYPE_CHANGE";
  key: string;
  oldKey?: string;
  old?: Stored;
  new?: Stored;
  oldIsSensitive?: boolean;
  newIsSensitive?: boolean;
};

async function log(
  environmentId: string,
  batchId: string,
  userId: string,
  when: Date,
  c: Change
) {
  await prisma.historyEntry.create({
    data: {
      environmentId,
      batchId,
      action: c.action,
      key: c.key,
      oldKey: c.oldKey ?? null,
      oldValue: c.old?.value ?? null,
      oldIv: c.old?.iv ?? null,
      oldAuthTag: c.old?.authTag ?? null,
      newValue: c.new?.value ?? null,
      newIv: c.new?.iv ?? null,
      newAuthTag: c.new?.authTag ?? null,
      oldIsSensitive: c.oldIsSensitive ?? null,
      newIsSensitive: c.newIsSensitive ?? null,
      changedById: userId,
      changedAt: when,
    },
  });
}

// Creates a variable and its CREATE history row (its own batch)
async function createWithHistory(
  environmentId: string,
  userId: string,
  key: string,
  value: string,
  sensitive: boolean,
  when: Date
) {
  const stored: Stored = sensitive ? encrypt(value) : plain(value);
  const v = await prisma.variable.create({
    data: {
      environmentId,
      key,
      value: stored.value,
      iv: stored.iv,
      authTag: stored.authTag,
      isSensitive: sensitive,
      updatedById: userId,
    },
    select: { id: true },
  });
  await log(environmentId, randomUUID(), userId, when, {
    action: "CREATE",
    key,
    new: stored,
    newIsSensitive: sensitive,
  });
  return { id: v.id, stored };
}

// Same rule as the app: once a key is Sensitive, its earlier plain history gets encrypted
async function encryptPlainHistory(environmentId: string, key: string) {
  const rows = await prisma.historyEntry.findMany({ where: { environmentId, key } });
  for (const r of rows) {
    const data: {
      oldValue?: string;
      oldIv?: string;
      oldAuthTag?: string;
      newValue?: string;
      newIv?: string;
      newAuthTag?: string;
    } = {};
    if (r.oldValue !== null && r.oldIv === null) {
      const e = encrypt(r.oldValue);
      data.oldValue = e.value;
      data.oldIv = e.iv;
      data.oldAuthTag = e.authTag;
    }
    if (r.newValue !== null && r.newIv === null) {
      const e = encrypt(r.newValue);
      data.newValue = e.value;
      data.newIv = e.iv;
      data.newAuthTag = e.authTag;
    }
    if (Object.keys(data).length > 0) {
      await prisma.historyEntry.update({ where: { id: r.id }, data });
    }
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: { email: "alice@example.com", name: "Alice Demo", passwordHash },
  });
  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: { email: "bob@example.com", name: "Bob Demo", passwordHash },
  });

  const existing = await prisma.project.findFirst({
    where: { name: "Demo Mobile App", ownerId: alice.id },
    select: { id: true },
  });
  if (existing) {
    console.log(
      "Demo project already exists, nothing to add. To rebuild the demo data: npx prisma migrate reset, then npm run db:seed"
    );
    return;
  }

  const now = Date.now();
  const project = await prisma.project.create({
    data: {
      name: "Demo Mobile App",
      ownerId: alice.id,
      members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      environments: {
        create: ["Development", "Staging", "Production"].map((name, i) => ({
          name,
          createdAt: new Date(now + i),
        })),
      },
    },
    select: { environments: { select: { id: true, name: true } } },
  });

  function findEnv(name: string) {
    const e = project.environments.find((x) => x.name === name);
    if (!e) throw new Error(`Environment ${name} missing`);
    return e;
  }
  const dev = findEnv("Development");
  const staging = findEnv("Staging");
  const prod = findEnv("Production");

  // Spread the history over the last three days so the timeline looks realistic
  const base = now - 3 * 24 * 60 * 60 * 1000;
  const t = (minutes: number) => new Date(base + minutes * 60_000);

  // ---- Development: plain variables ----
  await createWithHistory(dev.id, alice.id, "PORT", "3000", false, t(0));
  await createWithHistory(dev.id, bob.id, "API_URL", "http://localhost:3000/api", false, t(2));

  // DEBUG: created by Alice, changed by Bob (an UPDATE with old and new values)
  const debug = await createWithHistory(dev.id, alice.id, "DEBUG", "false", false, t(1));
  await prisma.variable.update({
    where: { id: debug.id },
    data: { value: "true", version: { increment: 1 }, updatedById: bob.id },
  });
  await log(dev.id, randomUUID(), bob.id, t(30), {
    action: "UPDATE",
    key: "DEBUG",
    old: plain("false"),
    new: plain("true"),
    oldIsSensitive: false,
    newIsSensitive: false,
  });

  // ---- Development: sensitive variables ----
  await createWithHistory(
    dev.id,
    alice.id,
    "DATABASE_URL",
    "postgres://demo:not-a-real-password@localhost:5432/demo",
    true,
    t(40)
  );

  // PAYMENT_API_KEY: Sensitive, then its value changed (history keeps both, encrypted)
  const pay = await createWithHistory(
    dev.id,
    alice.id,
    "PAYMENT_API_KEY",
    "demo-payment-key-not-real-1",
    true,
    t(50)
  );
  const payNew = encrypt("demo-payment-key-not-real-2");
  await prisma.variable.update({
    where: { id: pay.id },
    data: {
      value: payNew.value,
      iv: payNew.iv,
      authTag: payNew.authTag,
      version: { increment: 1 },
      updatedById: bob.id,
    },
  });
  await log(dev.id, randomUUID(), bob.id, t(90), {
    action: "UPDATE",
    key: "PAYMENT_API_KEY",
    old: pay.stored,
    new: payNew,
    oldIsSensitive: true,
    newIsSensitive: true,
  });

  // API_TOKEN: created as Standard, later switched to Sensitive (TYPE_CHANGE, old history protected)
  const tokenValue = "demo-token-123";
  const token = await createWithHistory(dev.id, alice.id, "API_TOKEN", tokenValue, false, t(100));
  const tokenStored = encrypt(tokenValue);
  await prisma.variable.update({
    where: { id: token.id },
    data: {
      value: tokenStored.value,
      iv: tokenStored.iv,
      authTag: tokenStored.authTag,
      isSensitive: true,
      version: { increment: 1 },
      updatedById: alice.id,
    },
  });
  await log(dev.id, randomUUID(), alice.id, t(120), {
    action: "TYPE_CHANGE",
    key: "API_TOKEN",
    oldIsSensitive: false,
    newIsSensitive: true,
  });
  await encryptPlainHistory(dev.id, "API_TOKEN");

  // FEATURE_X renamed by Bob (UPDATE with the old key, no values)
  const feature = await createWithHistory(dev.id, alice.id, "FEATURE_X", "on", false, t(130));
  await prisma.variable.update({
    where: { id: feature.id },
    data: { key: "FEATURE_NEW_CHECKOUT", version: { increment: 1 }, updatedById: bob.id },
  });
  await log(dev.id, randomUUID(), bob.id, t(150), {
    action: "UPDATE",
    key: "FEATURE_NEW_CHECKOUT",
    oldKey: "FEATURE_X",
    oldIsSensitive: false,
    newIsSensitive: false,
  });

  // OLD_FLAG created by Bob, deleted by Alice (history survives deletion)
  const flag = await createWithHistory(dev.id, bob.id, "OLD_FLAG", "legacy", false, t(160));
  await prisma.variable.delete({ where: { id: flag.id } });
  await log(dev.id, randomUUID(), alice.id, t(180), {
    action: "DELETE",
    key: "OLD_FLAG",
    old: plain("legacy"),
    oldIsSensitive: false,
  });

  // SMTP_PASSWORD: value changed AND made Sensitive in one save (one batch, two rows)
  const smtp = await createWithHistory(dev.id, alice.id, "SMTP_PASSWORD", "changeme", false, t(190));
  const smtpNew = encrypt("demo-smtp-password-2");
  await prisma.variable.update({
    where: { id: smtp.id },
    data: {
      value: smtpNew.value,
      iv: smtpNew.iv,
      authTag: smtpNew.authTag,
      isSensitive: true,
      version: { increment: 1 },
      updatedById: bob.id,
    },
  });
  const batch = randomUUID();
  await log(dev.id, batch, bob.id, t(200), {
    action: "UPDATE",
    key: "SMTP_PASSWORD",
    old: plain("changeme"),
    new: smtpNew,
    oldIsSensitive: false,
    newIsSensitive: true,
  });
  await log(dev.id, batch, bob.id, new Date(t(200).getTime() + 1), {
    action: "TYPE_CHANGE",
    key: "SMTP_PASSWORD",
    oldIsSensitive: false,
    newIsSensitive: true,
  });
  await encryptPlainHistory(dev.id, "SMTP_PASSWORD");

  // ---- Staging and Production ----
  await createWithHistory(staging.id, alice.id, "PORT", "8080", false, t(210));
  await createWithHistory(staging.id, bob.id, "API_URL", "https://staging.example.com/api", false, t(215));
  await createWithHistory(
    prod.id,
    alice.id,
    "ERROR_TRACKING_DSN",
    "https://demo-key@errors.example.com/1",
    true,
    t(220)
  );

  console.log(
    "Seeded: alice@example.com and bob@example.com (password: password123), with sensitive variables and a sample history."
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.name : "Unknown error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());