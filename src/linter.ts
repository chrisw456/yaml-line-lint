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

const KEY_PATTERN = /^([A-Za-z0-9_.\-]+):(\s|$)/;
const LIST_MARKER_PATTERN = /^(-\s+)+/;

export function lint(content: string, options: LintOptions = defaultOptions): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r\n|\r|\n/);
  const stack: MapFrame[] = [];

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      checkTrailingWhitespace(rawLine, lineNumber, findings);
      return;
    }

    const leading = rawLine.match(/^[ \t]*/)?.[0] ?? "";
    const tabIndex = leading.indexOf("\t");
    if (tabIndex !== -1) {
      findings.push({
        line: lineNumber,
        column: tabIndex + 1,
        rule: "no-tabs",
        severity: "error",
        message: "indentation uses a tab; YAML indentation must be spaces",
      });
    }

    checkTrailingWhitespace(rawLine, lineNumber, findings);

    if (rawLine.length > options.maxLineLength) {
      findings.push({
        line: lineNumber,
        column: options.maxLineLength + 1,
        rule: "line-length",
        severity: "warning",
        message: `line is ${rawLine.length} characters, longer than the ${options.maxLineLength} character limit`,
      });
    }

    checkDuplicateKey(rawLine, leading.length, lineNumber, stack, findings);
  });

  return findings;
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

  const keyMatch = remainder.match(KEY_PATTERN);
  if (!keyMatch) {
    return;
  }
  const key = keyMatch[1];
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
