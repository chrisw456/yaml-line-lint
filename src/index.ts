#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { defaultOptions, fixTrailingWhitespace, Finding, lint, LintOptions } from "./linter";

interface FileResult {
  file: string;
  findings: Finding[];
}

function parseArgs(argv: string[]): { files: string[]; json: boolean; fix: boolean; options: LintOptions } {
  const files: string[] = [];
  let json = false;
  let fix = false;
  const options: LintOptions = { ...defaultOptions };

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg.startsWith("--max-line-length=")) {
      const value = Number(arg.slice("--max-line-length=".length));
      if (!Number.isNaN(value) && value > 0) {
        options.maxLineLength = value;
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`unrecognized flag: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  return { files, json, fix, options };
}

function printHuman(results: FileResult[]): void {
  let total = 0;
  for (const { file, findings } of results) {
    if (findings.length === 0) {
      continue;
    }
    for (const finding of findings) {
      total += 1;
      console.log(
        `${file}:${finding.line}:${finding.column}  ${finding.severity.padEnd(7)}  ${finding.message}  [${finding.rule}]`,
      );
    }
  }
  if (total === 0) {
    console.log("no findings");
  } else {
    console.log(`\n${total} finding${total === 1 ? "" : "s"}`);
  }
}

function printJson(results: FileResult[]): void {
  const payload = results.map(({ file, findings }) => ({ file, findings }));
  console.log(JSON.stringify(payload, null, 2));
}

function main(): number {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const { files, json, fix, options } = parsed;

  if (files.length === 0) {
    console.error("usage: yaml-line-lint [--json] [--fix] [--max-line-length=N] <file.yaml> [more files...]");
    return 2;
  }

  const results: FileResult[] = [];
  let hasError = false;
  let fixedCount = 0;

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (err) {
      console.error(`could not read ${file}: ${(err as Error).message}`);
      return 2;
    }

    if (fix) {
      const fixed = fixTrailingWhitespace(content);
      if (fixed !== content) {
        writeFileSync(file, fixed, "utf8");
        content = fixed;
        fixedCount += 1;
      }
    }

    const findings = lint(content, options);
    if (findings.some((f) => f.severity === "error")) {
      hasError = true;
    }
    results.push({ file, findings });
  }

  if (fix && !json && fixedCount > 0) {
    console.log(`fixed trailing whitespace in ${fixedCount} file${fixedCount === 1 ? "" : "s"}`);
  }

  if (json) {
    printJson(results);
  } else {
    printHuman(results);
  }

  return hasError ? 1 : 0;
}

process.exitCode = main();
