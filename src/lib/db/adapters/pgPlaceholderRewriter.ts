/**
 * SQLite-to-Postgres placeholder rewriting: the `?`-to-`$n` scanner and the
 * keyword boundary check it relies on. Extracted from postgresDialect.ts.
 */

function isIdentifierChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Rewrite `?` placeholders to `$n`, skipping string literals ('...', "...",
 * `...`) and line/block comments. Returns the rewritten SQL.
 */
export function rewritePlaceholders(sql: string): string {
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let n = 0;
  let out = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      out += ch;
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += "/";
        i++;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === quote) {
        // Handle doubled quotes inside the literal ('' / "" escapes).
        if (next === quote) {
          out += next;
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      lineComment = true;
      out += "--";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      out += "/*";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "?") {
      n++;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Case-insensitive keyword match at cursor position (word boundary). */
function kwAt(sql: string, i: number, kw: string): boolean {
  if (sql.length - i < kw.length) return false;
  if (
    !sql
      .slice(i, i + kw.length)
      .toUpperCase()
      .startsWith(kw)
  )
    return false;
  const before = sql[i - 1];
  const after = sql[i + kw.length];
  const okBefore = before === undefined || !isIdentifierChar(before);
  const okAfter = after === undefined || !isIdentifierChar(after);
  return okBefore && okAfter;
}

/**
 * Rewrite INSERT OR IGNORE / INSERT OR REPLACE / REPLACE INTO to PG upserts.
 * INSERT OR IGNORE → ON CONFLICT DO NOTHING (append at end of statement).
 * INSERT OR REPLACE → ON CONFLICT DO UPDATE SET col=EXCLUDED.col for every
 * column listed in the INSERT column list (best-effort; falls back to
 * DO NOTHING when no column list is present).
 */
