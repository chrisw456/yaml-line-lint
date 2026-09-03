# yaml-line-lint

A small linter for YAML config files. It flags the mistakes that are easy to
make by hand and hard to spot by eye: tabs mixed into indentation, duplicate
keys in the same mapping, trailing whitespace, and lines that run too long.
Every finding comes with a line and column so you can jump straight to it.

It does not parse YAML into a full document tree. Config files are usually
broken in ways that show up in the raw text, and a line scanner catches those
without needing a parser, a schema, or any dependencies at all.

## Why

Most YAML linters (yamllint, spectral, etc.) pull in a parser and a rule
engine and expect a Python or Node toolchain with a lockfile. For a config
file in a small project that is often more setup than the problem is worth.
This is meant to be a single small tool you can drop into a repo, run in CI,
and read end to end in a few minutes.

## Usage

```
npm run build
node dist/index.js config.yaml
```

Example output:

```
config.yaml:4:1  error    duplicate key "port" in the same mapping  [duplicate-key]
config.yaml:9:12  warning  trailing whitespace  [trailing-whitespace]
config.yaml:15:1  error    indentation uses a tab; YAML indentation must be spaces  [no-tabs]

3 findings
```

Machine-readable output for CI or editor integrations:

```
node dist/index.js --json config.yaml
```

```json
[
  {
    "file": "config.yaml",
    "findings": [
      {
        "line": 4,
        "column": 1,
        "rule": "duplicate-key",
        "severity": "error",
        "message": "duplicate key \"port\" in the same mapping"
      }
    ]
  }
]
```

Multiple files can be passed at once; each gets its own entry in the JSON
array. The process exits with status 1 if any file has an `error`-severity
finding, and 0 otherwise, so it can gate a CI job.

## Options

- `--json` — emit findings as JSON instead of plain text.
- `--fix` — rewrite files in place, stripping trailing whitespace, before linting. Line endings are left as they were; other rules (tabs, duplicate keys, long lines) are reported but not auto-fixed.
- `--max-line-length=N` — override the default 120-character line limit.

## Rules

| rule                 | severity | what it catches                                   |
| -------------------- | -------- | -------------------------------------------------- |
| `no-tabs`             | error    | a tab character in leading indentation             |
| `duplicate-key`       | error    | the same key appearing twice in one mapping        |
| `trailing-whitespace` | warning  | spaces or tabs at the end of a line                |
| `line-length`         | warning  | a line longer than the configured limit            |

## Known limitations

The duplicate-key check recognizes bare keys (`key: value`), single- and
double-quoted keys (`'key': value`, `"key": value`), and flow-style mappings
(`{a: 1, b: 2}`) as long as the mapping opens and closes on the same line. A
flow mapping split across multiple lines is not tracked, and duplicate
detection treats a bare key and a quoted key with the same text as the same
key (as YAML does), but does not resolve anything beyond the `\n`/`\t`
escapes in a double-quoted key.

## Development

```
npm run build   # compiles src/ to dist/ with tsc
```

No third-party packages are required to build or run this; TypeScript is
listed as a devDependency purely for the compiler.
