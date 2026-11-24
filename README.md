<div align="center">

🚩

# Harness FME CLI

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/%40kud%2Fharness-fme-cli?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Terminal client for Harness FME (Split) feature flags: list, status, targeting and rollout changes with plans, backups and read-back checks.**

<a href="https://kud.io/projects/harness-fme-cli">Website</a> · <a href="https://kud.io/projects/harness-fme-cli/docs">Documentation</a>

</div>

## Features

- **Rollouts at a glance** — one table of flags against environments, with the rollout status and default rule for each; `unreleased` lists what is not fully on yet
- **Interactive dashboard** — `harness-fme tui` is a full-screen view of flags and environments, read-only unless you start it with `--write`
- **Change targeting from the shell** — add or remove an individual key on a treatment, serve `on` or `off`, ramp to a percentage, or act on a segment
- **Plan, backup, read-back** — every write prints a plan first, saves the original definition before it lands, and checks the flag afterwards, stopping at the first failure
- **Production guard** — an environment whose name matches `/prod/i` refuses to write unless its exact name is spelled out
- **Scriptable** — `--json` for machine-readable output, `--no-color` for plain text, stable exit codes, and API calls spaced politely with 429 reset headers honoured

## Install

```sh
npm install -g @kud/harness-fme-cli
```

Binary: `harness-fme` · Requires Node.js >= 22

There is deliberately no second binary. If you would rather type less, alias it:

```sh
alias fme=harness-fme
```

## Usage

```console
$ export HARNESS_FME_API_KEY=<your-api-key>
$ export HARNESS_FME_WORKSPACE="Storefront"

$ harness-fme list --env QA --env Prod
$ harness-fme status checkout_new_flow
$ harness-fme unreleased --env QA

$ harness-fme on checkout_new_flow --env QA
$ harness-fme on checkout_new_flow --env QA --go

$ harness-fme tui --env QA --env Prod
$ harness-fme tui --env QA --write
```

The first `on` shows the plan and writes nothing. The second applies it.

### Global options

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

### Dashboard

#### `tui`

A full-screen dashboard built on [`@kud/harness-fme-ink`](https://www.npmjs.com/package/@kud/harness-fme-ink). It needs an interactive terminal, and it is read-only unless started with `--write`. Takes `--tag`, `--prefix` and `-e, --env` to narrow what it loads.

| Key                       | Action                                                    |
| ------------------------- | --------------------------------------------------------- |
| `up` / `down`             | Move through the flags                                    |
| `left` / `right` or `tab` | Change the focused environment column                     |
| `space`                   | Mark or unmark a flag                                     |
| `enter`                   | Open a flag                                               |
| `r`                       | Refresh                                                   |
| `q`                       | Quit                                                      |
| `o`                       | Write: serve `on` for everyone (needs `--write`)          |
| `f`                       | Write: serve `off` (needs `--write`)                      |
| `a`                       | Write: add the `HARNESS_FME_KEY` key (needs `--write`)    |
| `x`                       | Write: remove the `HARNESS_FME_KEY` key (needs `--write`) |

The write keys act on the marked flags, or on the selected flag when none are marked, in the focused environment. They go through the same path as the commands below: a plan, a confirmation, a backup before each write, and a read-back after it.

The initial focus is never a production environment, and a production environment needs its exact name typed out before a write applies.

```sh
harness-fme tui --env QA --env Prod
HARNESS_FME_KEY=0a1b2c3d-0000-4000-8000-000000000001 harness-fme tui --env QA --write
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
6. **A production guard.** An environment whose name matches `/prod/i` refuses to write unless `--env <its exact name>` and `--go` are both given. `--env prod` for an environment called `Prod` is a refusal, not a guess. In the TUI the same rule applies: the exact name is typed out.
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
| `HARNESS_FME_KEY`       | Default for `--key`, and the key the TUI's `a` and `x` act on                                     |
| `NO_COLOR`              | Disable colour                                                                                    |

The API key is never printed, on success or on failure. Without one, the command exits with code 2 before making any request.

## Related packages

- [`@kud/harness-fme`](https://www.npmjs.com/package/@kud/harness-fme) — the core library this CLI is built on
- [`@kud/harness-fme-ink`](https://www.npmjs.com/package/@kud/harness-fme-ink) — the Ink components behind the dashboard
- [`@kud/mcp-harness-fme`](https://www.npmjs.com/package/@kud/mcp-harness-fme) — an MCP server for the same API

<!-- landing:skip -->

## Development

```sh
git clone https://github.com/kud/harness-fme-cli.git
cd harness-fme-cli
npm install
npm run dev -- list --env QA
```

| Script              | Purpose                        |
| ------------------- | ------------------------------ |
| `npm run build`     | Bundle to `dist/` with tsup    |
| `npm run dev`       | Run directly via tsx           |
| `npm run typecheck` | Type-check without emitting    |
| `npm test`          | Run the test suite with Vitest |

Tests drive the CLI against a fake API, so nothing touches a real workspace.

<!-- landing:/skip -->

📚 **Full documentation → [harness-fme-cli/docs](https://kud.io/projects/harness-fme-cli/docs)**
