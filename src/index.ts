#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { loadConfig } from "./config";
import { fixTrailingWhitespace, Finding, lint } from "./linter";

interface FileResult {
  file: string;
  findings: Finding[];
}

interface ParsedArgs {
  files: string[];
  json: boolean;
  fix: boolean;
  configPath: string | undefined;
  maxLineLengthOverride: number | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = [];
  let json = false;
  let fix = false;
  let configPath: string | undefined;
  let maxLineLengthOverride: number | undefined;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
    } else if (arg.startsWith("--max-line-length=")) {
      const value = Number(arg.slice("--max-line-length=".length));
      if (!Number.isNaN(value) && value > 0) {
        maxLineLengthOverride = value;
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`unrecognized flag: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  return { files, json, fix, configPath, maxLineLengthOverride };
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
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const { files, json, fix, configPath, maxLineLengthOverride } = parsed;

  if (files.length === 0) {
    console.error(
      "usage: yaml-line-lint [--json] [--fix] [--config=path] [--max-line-length=N] <file.yaml> [more files...]",
    );
    return 2;
  }

  let options;
  try {
    options = loadConfig(configPath);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  if (maxLineLengthOverride !== undefined) {
    options = { ...options, maxLineLength: maxLineLengthOverride };
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
