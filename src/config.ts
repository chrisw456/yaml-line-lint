// Loads rule/line-length overrides from a JSON config file. JSON rather than
// YAML on purpose: parsing our own config with the linter's line scanner (or
// a full YAML parser we don't otherwise need) would be a strange dependency
// for a tool whose whole point is staying dependency-free.

import { readFileSync } from "fs";
import { defaultOptions, LintOptions } from "./linter";

export const DEFAULT_CONFIG_FILE = ".yaml-line-lint.json";

interface RawConfig {
  maxLineLength?: unknown;
  rules?: unknown;
}

// `configPath` is an explicit path from --config. When omitted,
// DEFAULT_CONFIG_FILE is tried and silently skipped if it doesn't exist, so
// a project with no config file just gets defaultOptions.
export function loadConfig(configPath: string | undefined): LintOptions {
  const path = configPath ?? DEFAULT_CONFIG_FILE;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (configPath) {
      throw new Error(`could not read config file ${path}: ${(err as Error).message}`);
    }
    return defaultOptions;
  }

  let parsed: RawConfig;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in config file ${path}: ${(err as Error).message}`);
  }

  const options: LintOptions = {
    maxLineLength: defaultOptions.maxLineLength,
    disabledRules: new Set(),
  };

  if (parsed.maxLineLength !== undefined) {
    if (typeof parsed.maxLineLength !== "number" || parsed.maxLineLength <= 0) {
      throw new Error(`config file ${path}: "maxLineLength" must be a positive number`);
    }
    options.maxLineLength = parsed.maxLineLength;
  }

  if (parsed.rules !== undefined) {
    if (typeof parsed.rules !== "object" || parsed.rules === null || Array.isArray(parsed.rules)) {
      throw new Error(`config file ${path}: "rules" must be an object of rule name to boolean`);
    }
    const disabled = options.disabledRules as Set<string>;
    for (const [rule, enabled] of Object.entries(parsed.rules as Record<string, unknown>)) {
      if (typeof enabled !== "boolean") {
        throw new Error(`config file ${path}: rule "${rule}" must be true or false`);
      }
      if (!enabled) {
        disabled.add(rule);
      }
    }
  }

  return options;
}
