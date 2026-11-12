# @kud/harness-fme-cli

> Harness FME (formerly Split) feature flags from the terminal: look at rollouts, change targeting safely.

[![npm](https://img.shields.io/npm/v/@kud/harness-fme-cli)](https://www.npmjs.com/package/@kud/harness-fme-cli)
[![licence](https://img.shields.io/npm/l/@kud/harness-fme-cli)](LICENSE)
[![node](https://img.shields.io/node/v/@kud/harness-fme-cli)](package.json)

`harness-fme` is a terminal client for Harness FME feature flags, built on [`@kud/harness-fme`](https://www.npmjs.com/package/@kud/harness-fme). Reading is quick and quiet. Writing is deliberate: every change is a plan first, backed up before it lands, and checked after.

## Features

- **See rollouts at a glance**: one table of flags against environments, with the rollout status and default rule for each.
- **Find what is not live yet**: `unreleased` lists the flags that are not fully on in an environment.
- **Change targeting from the shell**: add or remove an individual key on a treatment, serve `on` or `off`, ramp to a percentage, or act on a segment.
- **Plan first**: every write prints a plan and writes nothing until you pass `--go`.
- **Backed up and verified**: the original definition is saved before each write, and the flag is read back and compared with the plan afterwards. The run stops at the first failure.
- **Production guard**: an environment whose name matches `/prod/i` refuses to write unless you spell out its exact name and pass `--go`.
- **Polite to the API**: calls are spaced about 550 ms apart and 429 reset headers are honoured.
- **Scriptable**: `--json` for machine-readable output, `--no-color` for plain text, and stable exit codes.

## Install

```sh
npm install -g @kud/harness-fme-cli
```

Requires Node 20 or later. The command is `harness-fme`; if you would rather type less:

```sh
alias fme=harness-fme
```

## Quick start

```sh
export HARNESS_FME_API_KEY=<your-api-key>
export HARNESS_FME_WORKSPACE="Storefront"

harness-fme list --env QA --env Prod
harness-fme status checkout_new_flow
harness-fme unreleased --env QA

harness-fme on checkout_new_flow --env QA
harness-fme on checkout_new_flow --env QA --go
```

The first `on` shows the plan and writes nothing. The second applies it.

## Command reference

Global options apply to every command.

| Option                       | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `-w, --workspace <id\|name>` | Workspace to use (default: the only one, or `HARNESS_FME_WORKSPACE`) |
| `--json`                     | Machine-readable output                                              |
| `--no-color`                 | Plain output (`NO_COLOR` works too)                                  |

### Reading

#### `list`

Rollout status and default rule per environment.

| Option              | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `--tag <tag>`       | Only flags with this tag                                                    |
| `--prefix <prefix>` | Only flags whose name starts with this                                      |
| `-e, --env <env>`   | Environment name or id; repeat or comma-separate for several (default: all) |
| `--all`             | Include archived flags                                                      |

```sh
harness-fme list --prefix checkout_ --env QA,Prod
```

#### `status <flag>`

One flag across every environment: state, default rule, traffic, rules, keys and segments. Takes `-e, --env` to narrow the environments.

```sh
harness-fme status checkout_new_flow
```

#### `unreleased --env <env>`

Flags that are not fully on in the given environment. `--env` is required. Also takes `--tag`, `--prefix` and `--all`.

```sh
harness-fme unreleased --env QA --tag payments
```

### Writing

Every write command takes the same options:

| Option                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `-e, --env <env>`     | Environment to change (required, exactly one)                         |
| `--prefix <prefix>`   | Target every active flag starting with this (instead of naming flags) |
| `--only <flag>`       | Restrict the write to this flag (repeatable)                          |
| `--limit <n>`         | Write at most this many flags                                         |
| `--go`                | Apply the plan; without it nothing is written                         |
| `--title <title>`     | Change title recorded by the API                                      |
| `--comment <comment>` | Change comment recorded by the API                                    |
| `--backup-dir <dir>`  | Where originals are saved (default `~/.harness-fme/backups`)          |

Name at least one flag, or pass `--prefix`, but not both.

#### `key add <flags...>` and `key remove <flags...>`

Add a key to, or remove it from, a treatment of each flag.

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `--key <id>`         | The key to use (default: `HARNESS_FME_KEY`) |
| `--treatment <name>` | Treatment to edit (default: `on`)           |

```sh
harness-fme key add checkout_new_flow --env QA --key 0a1b2c3d-0000-4000-8000-000000000001 --go
harness-fme key remove --prefix checkout_ --env QA --key 0a1b2c3d-0000-4000-8000-000000000001
```

Without `--key` and without `HARNESS_FME_KEY`, the command exits with code 2.

#### `on [flags...]` and `off [flags...]`

`on` serves the `on` treatment: to everyone by default, to a percentage, or to a segment. `off` serves `off` to everyone by default, or stops serving a segment.

| Option             | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `--segment <name>` | Act on this segment's membership of the `on` treatment         |
| `--percent <n>`    | `on` only: serve `on` to this share of traffic, the rest `off` |

`--percent` and `--segment` cannot be combined, and `--percent` is refused on `off` (use `off` itself for 0%).

```sh
harness-fme on checkout_new_flow --env QA --percent 25 --go
harness-fme on checkout_new_flow --env QA --segment beta_testers --go
harness-fme off checkout_new_flow --env QA --segment beta_testers --go
harness-fme off checkout_new_flow --env Prod --go
```

### Exit codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | Success (a dry run that planned cleanly included)                         |
| `1`  | Failure, such as an API error or a write that stopped midway              |
| `2`  | Usage error or refusal, such as a missing `--key` or the production guard |

## Safety model

Writes are the point of this tool, so they are the most careful part of it.

1. **A plan, always.** Every write resolves the flags, reads their current definitions and prints a table of what would change. Without `--go` that is all that happens: `Dry run: nothing was written`.
2. **A backup before each write.** With `--go`, the original definition is saved to `~/.harness-fme/backups/<run>/<env>/<flag>.json` (or under `--backup-dir`) immediately before that flag is written. The file holds the definition exactly as it was read, so a change can be put back by hand. Existing files are never overwritten.
3. **A read-back after each write.** The flag is read again and diffed against the plan. The run stops at the first failure, reports how many flags were changed and how many were not attempted, and exits with code 1.
4. **A way to go slowly.** `--only <flag>` and `--limit <n>` narrow what is written from a larger plan, so you can try one flag before the rest.
5. **Gentle on the API.** Calls are spaced about 550 ms apart, and when the API answers 429 the reset headers are honoured before retrying.
6. **A production guard.** An environment whose name matches `/prod/i` refuses to write unless `--env <its exact name>` and `--go` are both given. `--env prod` for an environment called `Prod` is a refusal, not a guess.
7. **Every write is labelled.** Each carries a title and comment, from sensible defaults or your own `--title` and `--comment`, so the change history says why.

A typical careful rollout, trying one flag from a prefix before the rest:

```sh
harness-fme on --prefix checkout_ --env Prod
harness-fme on --prefix checkout_ --env Prod --limit 1 \
  --title "Enable checkout flow" --comment "Planned rollout" --go
```

The first command is a plan only. The second writes a single flag; because `Prod` is the exact environment name and `--go` is present, the production guard is satisfied.

## Configuration

| Variable                | Purpose                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `HARNESS_FME_API_KEY`   | API key. `MCP_HARNESS_FME_API_KEY` is read too, so one exported key serves the MCP server as well |
| `HARNESS_FME_WORKSPACE` | Default workspace, by name or id                                                                  |
| `HARNESS_FME_KEY`       | Default for `--key`                                                                               |
| `NO_COLOR`              | Disable colour                                                                                    |

The API key is never printed, on success or on failure. Without one, the command exits with code 2 before making any request.

## Related packages

- [`@kud/harness-fme`](https://www.npmjs.com/package/@kud/harness-fme): the core library this CLI is built on
- [`@kud/mcp-harness-fme`](https://www.npmjs.com/package/@kud/mcp-harness-fme): an MCP server for the same API

## Development

```sh
npm install
npm run dev -- list --env QA
npm run typecheck
npm test
npm run build
```

Tests drive the CLI against a fake API, so nothing touches a real workspace.

## Licence

MIT
