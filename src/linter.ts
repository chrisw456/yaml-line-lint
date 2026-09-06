// Line-based YAML checks. This is deliberately not a full YAML parser: most
// config-file mistakes (tabs, duplicate keys, trailing whitespace) show up
// in the raw text and can be caught without building an AST, which is what
// keeps this dependency-free.

export type Severity = "error" | "warning";

export interface Finding {
  line: number; // 1-based
  column: number; // 1-based
  rule: string;
  severity: Severity;
  message: string;
}

export interface LintOptions {
  maxLineLength: number;
}

export const defaultOptions: LintOptions = {
  maxLineLength: 120,
};

interface MapFrame {
  indent: number;
  keys: Set<string>;
}

const BARE_KEY_PATTERN = /^[A-Za-z0-9_.\-]+/;
const LIST_MARKER_PATTERN = /^(-\s+)+/;

export function lint(content: string, options: LintOptions = defaultOptions): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r\n|\r|\n/);
  const stack: MapFrame[] = [];

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    const ignore = parseIgnoreDirective(rawLine);
    const lineFindings: Finding[] = [];

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      checkTrailingWhitespace(rawLine, lineNumber, lineFindings);
      pushAllowed(lineFindings, ignore, findings);
      return;
    }

    const leading = rawLine.match(/^[ \t]*/)?.[0] ?? "";
    const tabIndex = leading.indexOf("\t");
    if (tabIndex !== -1) {
      lineFindings.push({
        line: lineNumber,
        column: tabIndex + 1,
        rule: "no-tabs",
        severity: "error",
        message: "indentation uses a tab; YAML indentation must be spaces",
      });
    }

    checkTrailingWhitespace(rawLine, lineNumber, lineFindings);

    if (rawLine.length > options.maxLineLength) {
      lineFindings.push({
        line: lineNumber,
        column: options.maxLineLength + 1,
        rule: "line-length",
        severity: "warning",
        message: `line is ${rawLine.length} characters, longer than the ${options.maxLineLength} character limit`,
      });
    }

    // Always update the duplicate-key stack, even if this line's findings end
    // up suppressed below, so an ignored duplicate still registers its key
    // and a later, unignored duplicate of the same key is still caught.
    checkDuplicateKey(rawLine, leading.length, lineNumber, stack, lineFindings);

    if (rawLine.includes("{")) {
      checkFlowMappings(rawLine, lineNumber, lineFindings);
    }

    pushAllowed(lineFindings, ignore, findings);
  });

  return findings;
}

// Recognizes a trailing `# lint:ignore` or `# lint:ignore=rule-a,rule-b`
// comment. Returns "all" to suppress every finding on the line, a Set of
// rule names to suppress only those, or null if the line has no directive.
function parseIgnoreDirective(rawLine: string): "all" | Set<string> | null {
  const commentIndex = findCommentStart(rawLine);
  if (commentIndex === -1) {
    return null;
  }
  const comment = rawLine.slice(commentIndex);
  const match = comment.match(/^#\s*lint:ignore(?:=([\w-]+(?:,[\w-]+)*))?(?:\s|$)/);
  if (!match) {
    return null;
  }
  if (!match[1]) {
    return "all";
  }
  return new Set(match[1].split(","));
}

function pushAllowed(lineFindings: Finding[], ignore: "all" | Set<string> | null, findings: Finding[]): void {
  if (ignore === "all") {
    return;
  }
  for (const finding of lineFindings) {
    if (ignore instanceof Set && ignore.has(finding.rule)) {
      continue;
    }
    findings.push(finding);
  }
}

// Strips trailing spaces/tabs from every line while leaving each line's
// original terminator (\n, \r\n, \r, or none on the last line) untouched.
export function fixTrailingWhitespace(content: string): string {
  const parts = content.split(/(\r\n|\r|\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/[ \t]+$/, "");
  }
  return parts.join("");
}

function checkTrailingWhitespace(rawLine: string, lineNumber: number, findings: Finding[]): void {
  const match = rawLine.match(/[ \t]+$/);
  if (match) {
    findings.push({
      line: lineNumber,
      column: rawLine.length - match[0].length + 1,
      rule: "trailing-whitespace",
      severity: "warning",
      message: "trailing whitespace",
    });
  }
}

function checkDuplicateKey(
  rawLine: string,
  baseIndent: number,
  lineNumber: number,
  stack: MapFrame[],
  findings: Finding[],
): void {
  const content = rawLine.slice(baseIndent);
  const listMarker = content.match(LIST_MARKER_PATTERN);
  const isNewListItem = listMarker !== null;
  const effectiveIndent = baseIndent + (listMarker?.[0].length ?? 0);
  const remainder = isNewListItem ? content.slice(listMarker![0].length) : content;

  const keyResult = readKey(remainder);
  if (!keyResult) {
    return;
  }
  const afterKey = remainder.slice(keyResult.length);
  if (!/^:(\s|$)/.test(afterKey)) {
    return;
  }
  const key = keyResult.key;
  const keyColumn = effectiveIndent + 1;

  if (isNewListItem) {
    // A list item always starts a fresh mapping, even if its indent
    // matches an existing frame (siblings must not share a key set).
    while (stack.length > 0 && stack[stack.length - 1].indent >= effectiveIndent) {
      stack.pop();
    }
    stack.push({ indent: effectiveIndent, keys: new Set([key]) });
    return;
  }

  while (stack.length > 0 && stack[stack.length - 1].indent > effectiveIndent) {
    stack.pop();
  }

  const top = stack[stack.length - 1];
  if (!top || top.indent < effectiveIndent) {
    stack.push({ indent: effectiveIndent, keys: new Set([key]) });
    return;
  }

  if (top.keys.has(key)) {
    findings.push({
      line: lineNumber,
      column: keyColumn,
      rule: "duplicate-key",
      severity: "error",
      message: `duplicate key "${key}" in the same mapping`,
    });
  } else {
    top.keys.add(key);
  }
}

// Reads a single YAML scalar key from the start of `text`: a bare identifier,
// or a single- or double-quoted string with its quoting rules (`''` escapes a
// quote in single-quoted strings, `\"` and friends in double-quoted ones).
// Returns the decoded key and how many characters of `text` it consumed
// (quotes included), or null if `text` does not start with a valid key.
function readKey(text: string): { key: string; length: number } | null {
  if (text[0] === "'") {
    let i = 1;
    let value = "";
    while (i < text.length) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        return { key: value, length: i + 1 };
      }
      value += text[i];
      i += 1;
    }
    return null;
  }

  if (text[0] === '"') {
    let i = 1;
    let value = "";
    while (i < text.length) {
      if (text[i] === "\\" && i + 1 < text.length) {
        const next = text[i + 1];
        switch (next) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          default:
            value += next;
        }
        i += 2;
        continue;
      }
      if (text[i] === '"') {
        return { key: value, length: i + 1 };
      }
      value += text[i];
      i += 1;
    }
    return null;
  }

  const match = text.match(BARE_KEY_PATTERN);
  if (!match) {
    return null;
  }
  return { key: match[0], length: match[0].length };
}

// Skips over a quoted scalar starting at `text[start]` (which must be a
// quote character) and returns the index just past its closing quote, or -1
// if the quote is never closed on this line.
function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (quote === "'") {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          i += 2;
          continue;
        }
        return i + 1;
      }
    } else if (text[i] === "\\") {
      i += 2;
      continue;
    } else if (text[i] === '"') {
      return i + 1;
    }
    i += 1;
  }
  return -1;
}

// Flow mappings (`{a: 1, b: 2}`) are their own self-contained scope: a
// duplicate key inside one is a mistake regardless of the surrounding
// block-style indentation, so this check runs independently of the
// indentation stack used for block mappings. Only mappings that open and
// close on the same line are checked; one that spans multiple lines is left
// alone rather than risk a false positive.
function checkFlowMappings(rawLine: string, lineNumber: number, findings: Finding[]): void {
  const commentIndex = findCommentStart(rawLine);
  const scanned = commentIndex === -1 ? rawLine : rawLine.slice(0, commentIndex);

  let searchFrom = 0;
  while (true) {
    const openIndex = scanned.indexOf("{", searchFrom);
    if (openIndex === -1) {
      return;
    }
    const closeIndex = findMatchingBrace(scanned, openIndex);
    if (closeIndex === -1) {
      return;
    }
    checkFlowMappingKeys(scanned, openIndex, closeIndex, lineNumber, findings);
    searchFrom = closeIndex + 1;
  }
}

function findCommentStart(text: string): number {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

function checkFlowMappingKeys(
  text: string,
  openIndex: number,
  closeIndex: number,
  lineNumber: number,
  findings: Finding[],
): void {
  const inner = text.slice(openIndex + 1, closeIndex);
  const seen = new Set<string>();
  let itemStart = openIndex + 1;

  for (const item of splitFlowItems(inner)) {
    const offset = item.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = item.trim();
    const column = itemStart + offset + 1;
    itemStart += item.length + 1; // +1 for the comma separating items

    if (trimmed.length === 0) {
      continue;
    }
    const keyResult = readKey(trimmed);
    if (!keyResult) {
      continue;
    }
    if (!/^\s*:(\s|$)/.test(trimmed.slice(keyResult.length))) {
      continue;
    }

    const key = keyResult.key;
    if (seen.has(key)) {
      findings.push({
        line: lineNumber,
        column,
        rule: "duplicate-key",
        severity: "error",
        message: `duplicate key "${key}" in the same flow mapping`,
      });
    } else {
      seen.add(key);
    }
  }
}

// Splits the inside of a flow mapping on top-level commas, leaving commas
// nested inside quoted strings, `{}`, or `[]` untouched.
function splitFlowItems(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(text, i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  items.push(text.slice(start));
  return items;
}
