import { describe, it, expect } from "vitest";
import { parseEnv } from "./parseEnv";

describe("parseEnv: basics", () => {
  it("parses simple pairs", () => {
    const { entries, issues } = parseEnv("PORT=3000\nDEBUG=true");
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ["PORT", "3000"],
      ["DEBUG", "true"],
    ]);
    expect(issues).toEqual([]);
  });

  it("skips blank lines and comments", () => {
    const { entries } = parseEnv("# comment\n\n   \n  # indented comment\nA=1");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("A");
  });

  it("keeps '=' inside values", () => {
    const { entries } = parseEnv("URL=postgres://h/db?a=b&c=d");
    expect(entries[0].value).toBe("postgres://h/db?a=b&c=d");
  });

  it("handles export prefix", () => {
    const { entries } = parseEnv("export TOKEN=abc");
    expect(entries[0]).toMatchObject({ key: "TOKEN", value: "abc", hadExport: true });
  });

  it("handles CRLF and BOM", () => {
    const { entries } = parseEnv("\uFEFFA=1\r\nB=2\r\n");
    expect(entries.map((e) => e.key)).toEqual(["A", "B"]);
    expect(entries[0].value).toBe("1");
  });

  it("allows empty values", () => {
    const { entries } = parseEnv("EMPTY=");
    expect(entries[0].value).toBe("");
  });

  it("reports lines without '=' and invalid keys", () => {
    const { entries, issues } = parseEnv("JUSTTEXT\n1BAD=x\nGOOD=y");
    expect(entries.map((e) => e.key)).toEqual(["GOOD"]);
    expect(issues.map((i) => i.kind)).toEqual(["INVALID_LINE", "INVALID_KEY"]);
    expect(issues[0].line).toBe(1);
    expect(issues[1].line).toBe(2);
  });

  it("allows spaces around the key and '='", () => {
    const { entries } = parseEnv("  NAME  =  Alice  ");
    expect(entries[0]).toMatchObject({ key: "NAME", value: "Alice" });
  });
});

describe("parseEnv: values", () => {
  it("strips inline comments only when # follows whitespace", () => {
    const { entries } = parseEnv(
      "PORT=3000 # dev\nCOLOR=#fff\nURL=http://x/#frag"
    );
    expect(entries.map((e) => e.value)).toEqual([
      "3000",
      "#fff",
      "http://x/#frag",
    ]);
  });

  it("unwraps double and single quotes", () => {
    const { entries } = parseEnv(`A="hello world"\nB='hi there'\nC=""`);
    expect(entries.map((e) => e.value)).toEqual(["hello world", "hi there", ""]);
  });

  it("keeps # and spaces inside quotes, ignores trailing comment after quote", () => {
    const { entries } = parseEnv(`A="x # y"\nB="x" # note`);
    expect(entries.map((e) => e.value)).toEqual(["x # y", "x"]);
  });

  it("processes escapes in double quotes only", () => {
    const { entries } = parseEnv(
      'A="a\\nb"\nB="say \\"hi\\""\nC=\'a\\nb\''
    );
    expect(entries[0].value).toBe("a\nb"); // real newline
    expect(entries[1].value).toBe('say "hi"');
    expect(entries[2].value).toBe("a\\nb"); // literal backslash-n
  });

  it("supports multiline quoted values and keeps line numbers right", () => {
    const { entries, issues } = parseEnv(
      'KEY="line1\nline2\nline3"\nNEXT=1'
    );
    expect(issues).toEqual([]);
    expect(entries[0]).toMatchObject({ key: "KEY", value: "line1\nline2\nline3", line: 1 });
    expect(entries[1]).toMatchObject({ key: "NEXT", value: "1", line: 4 });
  });

  it("supports a PEM-style private key", () => {
    const pem = "-----BEGIN KEY-----\nabc\n-----END KEY-----";
    const { entries } = parseEnv(`PRIVATE_KEY="${pem}"`);
    expect(entries[0].value).toBe(pem);
  });

  it("reports an unterminated quote without eating the rest of the file", () => {
    const { entries, issues } = parseEnv('A="abc\nB=2');
    expect(issues.map((i) => i.kind)).toEqual(["UNTERMINATED_QUOTE"]);
    expect(issues[0].line).toBe(1);
    expect(entries.map((e) => e.key)).toEqual(["B"]);
  });

  it("issue messages never contain the value", () => {
    const { issues } = parseEnv('SECRET="topsecretvalue');
    expect(JSON.stringify(issues.map((i) => i.message))).not.toContain("topsecretvalue");
  });
});

describe("parseEnv: duplicates", () => {
  it("last value wins, first position kept, warning raised", () => {
    const { entries, issues } = parseEnv("A=1\nB=2\nA=3");
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ["A", "3"],
      ["B", "2"],
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "DUPLICATE_KEY", line: 3 });
    expect(issues[0].message).toContain("line 1");
  });

  it("treats keys that differ only by case as different keys", () => {
    const { entries, issues } = parseEnv("Port=1\nPORT=2");
    expect(entries.map((e) => e.key)).toEqual(["Port", "PORT"]);
    expect(issues).toEqual([]);
  });

  it("duplicate warning never contains the value", () => {
    const { issues } = parseEnv("K=firstsecret\nK=secondsecret");
    const msgs = JSON.stringify(issues.map((i) => i.message));
    expect(msgs).not.toContain("firstsecret");
    expect(msgs).not.toContain("secondsecret");
  });
});

describe("parseEnv: robustness", () => {
  // Small deterministic PRNG (mulberry32)
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pieces = [
    "A", "KEY", "_x", "1", "=", "==", '"', "'", "\\", "\\n", "#", " ", "  ",
    "\n", "\r\n", "export ", "\uFEFF", "$", "{", "}", "é", "\t",
  ];

  it("never throws on random garbage and always returns valid shapes", () => {
    const rand = rng(12345);
    for (let n = 0; n < 2000; n++) {
      const len = Math.floor(rand() * 40);
      let s = "";
      for (let k = 0; k < len; k++) s += pieces[Math.floor(rand() * pieces.length)];
      const result = parseEnv(s);
      expect(Array.isArray(result.entries)).toBe(true);
      expect(Array.isArray(result.issues)).toBe(true);
      for (const e of result.entries) {
        expect(e.key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
        expect(typeof e.value).toBe("string");
      }
    }
  });

  it("handles a large input quickly", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `KEY_${i}=value_${i}`).join("\n");
    const start = Date.now();
    const { entries } = parseEnv(big);
    expect(entries).toHaveLength(5000);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("parseEnv: messy realistic file", () => {
  it("parses a mixed Windows-style file correctly", () => {
    const text = [
      "\uFEFF# Server config",
      "export NODE_ENV=production",
      "PORT=3000 # default port",
      'HOST = "0.0.0.0"',
      "",
      "DATABASE_URL=postgres://user:pass@db:5432/app?sslmode=require",
      "COLOR=#ff0000",
      "GREETING='Hello, world'",
      'PRIVATE_KEY="-----BEGIN KEY-----',
      "abc123",
      '-----END KEY-----"',
      "EMPTY=",
      "not a valid line",
      "1BAD=oops",
      "PORT=4000",
    ].join("\r\n");

    const { entries, issues } = parseEnv(text);

    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ["NODE_ENV", "production"],
      ["PORT", "4000"],
      ["HOST", "0.0.0.0"],
      ["DATABASE_URL", "postgres://user:pass@db:5432/app?sslmode=require"],
      ["COLOR", "#ff0000"],
      ["GREETING", "Hello, world"],
      ["PRIVATE_KEY", "-----BEGIN KEY-----\nabc123\n-----END KEY-----"],
      ["EMPTY", ""],
    ]);
    expect(entries[0].hadExport).toBe(true);

    expect(issues.map((i) => [i.line, i.kind])).toEqual([
      [13, "INVALID_LINE"],
      [14, "INVALID_KEY"],
      [15, "DUPLICATE_KEY"],
    ]);
  });
});