export type ParsedEntry = {
  key: string;
  value: string;
  line: number; // 1-based line where the entry starts
  hadExport: boolean;
};

export type ParseIssueKind =
  | "INVALID_LINE"
  | "INVALID_KEY"
  | "DUPLICATE_KEY"
  | "UNTERMINATED_QUOTE";

export type ParseIssue = {
  line: number;
  kind: ParseIssueKind;
  message: string; // never contains the value
  raw: string; // the raw line; the UI must treat it as sensitive
};

export type ParseResult = {
  entries: ParsedEntry[];
  issues: ParseIssue[];
};

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Strip a leading BOM and convert CRLF / lone CR to LF.
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

// Unquoted values: cut at the first " #" (a # preceded by whitespace).
// "COLOR=#fff" and "URL=http://x/#frag" keep their "#".
function stripInlineComment(s: string): string {
  const m = /\s#/.exec(s);
  return (m ? s.slice(0, m.index) : s).trim();
}

// Reads a quoted value that may span several lines.
// `text` is the rest of the starting line AFTER the opening quote.
// Returns null if the closing quote is never found.
function parseQuoted(
  lines: string[],
  startIdx: number,
  text: string,
  quote: '"' | "'"
): { value: string; endIdx: number } | null {
  let value = "";
  let idx = startIdx;
  let cur = text;

  while (true) {
    for (let c = 0; c < cur.length; c++) {
      const ch = cur[c];

      // Escapes only apply inside double quotes
      if (quote === '"' && ch === "\\" && c + 1 < cur.length) {
        const next = cur[c + 1];
        if (next === "n") value += "\n";
        else if (next === '"') value += '"';
        else if (next === "\\") value += "\\";
        else value += "\\" + next; // unknown escape: keep as written
        c++;
        continue;
      }

      if (ch === quote) return { value, endIdx: idx }; // closing quote found
      value += ch;
    }

    // End of line without a closing quote: continue on the next line
    idx++;
    if (idx >= lines.length) return null;
    value += "\n";
    cur = lines[idx];
  }
}

export function parseEnv(text: string): ParseResult {
  const lines = normalizeText(text).split("\n");
  const byKey = new Map<string, ParsedEntry>(); // keeps first-seen order
  const issues: ParseIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    // Blank lines and comment lines
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Optional "export " prefix
    let body = trimmed;
    let hadExport = false;
    const exportMatch = /^export\s+/.exec(body);
    if (exportMatch) {
      hadExport = true;
      body = body.slice(exportMatch[0].length);
    }

    // Split on the FIRST "=" only
    const eq = body.indexOf("=");
    if (eq === -1) {
      issues.push({
        line: lineNo,
        kind: "INVALID_LINE",
        message: "Line has no '=' sign, so it was skipped.",
        raw,
      });
      continue;
    }

    const key = body.slice(0, eq).trim();
    const rest = body.slice(eq + 1);

    if (!KEY_RE.test(key)) {
      issues.push({
        line: lineNo,
        kind: "INVALID_KEY",
        message:
          "Key must start with a letter or underscore and contain only letters, numbers and underscores.",
        raw,
      });
      continue;
    }

    const v = rest.trimStart();
    let value: string;

    if (v.startsWith('"') || v.startsWith("'")) {
      const quote = v[0] as '"' | "'";
      const result = parseQuoted(lines, i, v.slice(1), quote);
      if (!result) {
        // Don't swallow the rest of the file: report it, skip this entry,
        // and carry on with the next line.
        issues.push({
          line: lineNo,
          kind: "UNTERMINATED_QUOTE",
          message: "Quoted value has no closing quote, so it was skipped.",
          raw,
        });
        continue;
      }
      value = result.value;
      i = result.endIdx; // jump past any lines the value consumed
    } else {
      value = stripInlineComment(v);
    }

        const previous = byKey.get(key);
    if (previous) {
      issues.push({
        line: lineNo,
        kind: "DUPLICATE_KEY",
        message: `Key appears more than once (first on line ${previous.line}); the last value was used.`,
        raw,
      });
    }
    // Map.set on an existing key keeps its original position
    byKey.set(key, { key, value, line: lineNo, hadExport });
  }

    return { entries: [...byKey.values()], issues };
}