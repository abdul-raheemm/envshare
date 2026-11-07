import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(path.join(ROOT, "src")).map((f) => ({
  file: path.relative(ROOT, f).replaceAll("\\", "/"),
  text: readFileSync(f, "utf8"),
}));
const nonTest = files.filter((f) => !f.file.endsWith(".test.ts"));

const importsOf = (text: string, mod: string) =>
  new RegExp(`from\\s+["']${mod.replace(/[/@]/g, "\\$&")}["']`).test(text);

function routeMethods(text: string): string[] {
  return [...text.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
}
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("code-level security rules", () => {
  it("only the audited server modules import the crypto helper", () => {
    const importers = nonTest.filter((f) => importsOf(f.text, "@/lib/crypto")).map((f) => f.file).sort();
    expect(importers).toEqual([
      "src/lib/history.ts",
      "src/lib/historyRead.ts",
      "src/lib/reveal.ts",
      "src/lib/variables.ts",
    ]);
  });

  it('no "use client" file imports server-only modules', () => {
    const forbidden = [
      "@/lib/crypto",
      "@/lib/db",
      "@/lib/access",
      "@/lib/session",
      "@/lib/variables",
      "@/lib/reveal",
      "@/lib/history",
      "@/lib/historyRead",
    ];
    const offenders: string[] = [];
    for (const f of nonTest) {
      if (!/^\s*["']use client["']/.test(f.text)) continue;
      for (const mod of forbidden) {
        if (importsOf(f.text, mod)) offenders.push(`${f.file} imports ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every API route outside /api/auth requires a logged-in user", () => {
    const routes = nonTest.filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f.file) && !f.file.includes("/api/auth/"));
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter((f) => !f.text.includes("requireUser(")).map((f) => f.file);
    expect(missing).toEqual([]);
  });

  it("the history and reveal routes expose only the intended methods", () => {
    expect(routeMethods(read("src/app/api/environments/[environmentId]/history/route.ts"))).toEqual(["GET"]);
    expect(routeMethods(read("src/app/api/history/[entryId]/reveal/route.ts"))).toEqual(["POST"]);
    expect(routeMethods(read("src/app/api/variables/[variableId]/reveal/route.ts"))).toEqual(["POST"]);
  });

  it("routes that can return secrets set Cache-Control: no-store", () => {
    for (const p of [
      "src/app/api/environments/[environmentId]/history/route.ts",
      "src/app/api/history/[entryId]/reveal/route.ts",
      "src/app/api/variables/[variableId]/reveal/route.ts",
    ]) {
      expect(read(p), p).toContain("no-store");
    }
  });

  it("history is append-only (the only update is the re-encryption in history.ts)", () => {
    const destructive = nonTest.filter((f) => /historyEntry\.(delete|deleteMany|updateMany|upsert)\b/.test(f.text)).map((f) => f.file);
    expect(destructive).toEqual([]);
    const updaters = nonTest.filter((f) => /historyEntry\.update\b/.test(f.text)).map((f) => f.file);
    expect(updaters).toEqual(["src/lib/history.ts"]);
  });

  it("no console logging outside the central error handler", () => {
    // If this fails for a legitimate reason, review the line and add the file to the allowlist.
    const allowed = new Set(["src/lib/errors.ts"]);
    const offenders = nonTest.filter((f) => !allowed.has(f.file) && /\bconsole\.\w+/.test(f.text)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("no browser storage, raw HTML injection or raw SQL in app code", () => {
    const offenders = nonTest
      .filter((f) => /localStorage|sessionStorage|dangerouslySetInnerHTML|\$queryRaw|\$executeRaw/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});

function trackedFilesContaining(value: string): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-F", "--", value], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

describe("secrets hygiene", () => {
    it(".env is git-ignored and untracked", () => {
    // git is the authority: check-ignore exits 0 only when the path is ignored
    expect(() => execFileSync("git", ["check-ignore", "-q", ".env"])).not.toThrow();
    const tracked = execFileSync("git", ["ls-files", ".env"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });

  it(".env.example holds placeholders, not real keys", () => {
        expect(read(".env.example")).not.toMatch(/^ENCRYPTION_KEY=["']?[0-9a-fA-F]{64}["']?\s*$/m);
  });

  it("the real ENCRYPTION_KEY and JWT_SECRET appear in no tracked file", () => {
    expect(existsSync(path.join(ROOT, ".env"))).toBe(true);
    const env = read(".env");
    for (const name of ["ENCRYPTION_KEY", "JWT_SECRET"]) {
      const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
      const value = m?.[1]?.trim().replace(/^["']|["']$/g, "");
      expect(value, `${name} missing from .env`).toBeTruthy();
      expect(trackedFilesContaining(value!), `${name} is committed somewhere`).toEqual([]);
    }
  });
});