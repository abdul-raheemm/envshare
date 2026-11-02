import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Demo accounts only. Never use this password for anything real.
const DEMO_PASSWORD = "password123";

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
    console.log("Demo project already exists, nothing to add.");
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

  const dev = project.environments.find((e) => e.name === "Development");
  if (dev) {
    await prisma.variable.createMany({
      data: [
        { environmentId: dev.id, key: "PORT", value: "3000", updatedById: alice.id },
        { environmentId: dev.id, key: "DEBUG", value: "true", updatedById: alice.id },
        { environmentId: dev.id, key: "API_URL", value: "http://localhost:3000/api", updatedById: bob.id },
      ],
    });
  }

  console.log("Seeded: alice@example.com and bob@example.com (password: password123)");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.name : "Unknown error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());