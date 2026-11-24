import { Command, CommanderError, Option } from "commander"
import {
  addKeyOperation,
  removeKeyOperation,
  turnOffOperation,
  turnOnOperation,
  type FlagOperation,
} from "@kud/harness-fme"
import { runCompare } from "./commands/compare.js"
import { runHistory } from "./commands/history.js"
import { runList, runStatus, runUnreleased } from "./commands/read.js"
import { runTui } from "./commands/tui.js"
import {
  CliError,
  defaultDeps,
  makeContext,
  type Context,
  type Deps,
  type GlobalOptions,
} from "./context.js"
import { runWrite, type WriteOptions } from "./write-flow.js"

const collect = (value: string, previous: string[] = []) => [...previous, value]

const ENV_HELP =
  "environment name or id (repeat or comma-separate for several; default: all)"

const writeOptions = (command: Command) =>
  command
    .requiredOption("-e, --env <env>", "environment to change (required)")
    .option("--prefix <prefix>", "target every active flag starting with this")
    .option(
      "--only <flag>",
      "restrict the write to this flag (repeatable)",
      collect,
    )
    .option("--limit <n>", "write at most this many flags")
    .option("--go", "apply the plan; without it nothing is written")
    .option("--title <title>", "change title recorded by the API")
    .option("--comment <comment>", "change comment recorded by the API")
    .option(
      "--backup-dir <dir>",
      "where originals are saved (default ~/.harness-fme/backups)",
    )

const WRITE_EPILOGUE = `
Every write is a plan until --go is given. Before each write the original
definition is saved; after it the flag is read back and compared with the plan,
and the run stops at the first mismatch. An environment named like production
needs --env <its exact name> --go.`

export const buildProgram = (
  deps: Deps,
  onAction: (code: number) => void,
): Command => {
  const program = new Command()
  program
    .name("harness-fme")
    .description(
      "Harness FME (Split) feature flags from the terminal: look at rollouts, change targeting safely.",
    )
    .option(
      "-w, --workspace <id|name>",
      "workspace (default: the only one, or HARNESS_FME_WORKSPACE)",
    )
    .option("--json", "machine-readable output")
    .option("--no-color", "plain output")
    .addHelpText(
      "after",
      `
Environment:
  HARNESS_FME_API_KEY       API key (MCP_HARNESS_FME_API_KEY is read too)
  HARNESS_FME_WORKSPACE     default workspace, by name or id
  HARNESS_FME_KEY           default for --key
  NO_COLOR                  disable colour`,
    )
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => deps.write(text),
      writeErr: (text) => deps.writeError(text),
    })

  const contextFor = (command: Command): Context => {
    const globals = command.optsWithGlobals<GlobalOptions>()
    return makeContext(deps, globals)
  }

  const action =
    <A extends unknown[]>(
      handler: (ctx: Context, command: Command, ...args: A) => Promise<number>,
    ) =>
    async (...raw: unknown[]) => {
      const command = raw[raw.length - 1] as Command
      const args = raw.slice(0, -1) as unknown as A
      onAction(await handler(contextFor(command), command, ...args))
    }

  program
    .command("list")
    .description("rollout status and default rule per environment")
    .option("--tag <tag>", "only flags with this tag")
    .option("--prefix <prefix>", "only flags whose name starts with this")
    .option("-e, --env <env>", ENV_HELP, collect, [])
    .option("--all", "include archived flags")
    .action(action(async (ctx, command) => runList(ctx, command.opts())))

  program
    .command("status")
    .description("one flag, every environment at a glance")
    .argument("<flag>", "flag name")
    .option("-e, --env <env>", ENV_HELP, collect, [])
    .action(
      action<[string]>(async (ctx, command, flag) =>
        runStatus(ctx, flag, command.opts()),
      ),
    )

  program
    .command("compare")
    .description(
      "one flag across environments, side by side, differences marked",
    )
    .argument("<flag>", "flag name")
    .option("-e, --env <env>", ENV_HELP, collect, [])
    .action(
      action<[string]>(async (ctx, command, flag) =>
        runCompare(ctx, flag, command.opts()),
      ),
    )

  program
    .command("history")
    .description(
      "published change requests for one flag in one environment, with what each changed",
    )
    .argument("<flag>", "flag name")
    .requiredOption("-e, --env <env>", "environment name or id (required)")
    .option("--limit <n>", "show at most this many changes", "20")
    .addHelpText(
      "after",
      `
The admin API has no audit log. This reads the change requests that were
published for the flag (changes made through an approval flow) and diffs each
against the one before. Direct edits that skipped approvals are not listed.
Needs an admin API key with access to change requests.`,
    )
    .action(
      action<[string]>(async (ctx, command, flag) =>
        runHistory(ctx, flag, command.opts()),
      ),
    )

  program
    .command("unreleased")
    .description("flags that are not fully on in an environment")
    .option("-e, --env <env>", "environment to check (required)", collect, [])
    .option("--tag <tag>", "only flags with this tag")
    .option("--prefix <prefix>", "only flags whose name starts with this")
    .option("--all", "include archived flags")
    .action(action(async (ctx, command) => runUnreleased(ctx, command.opts())))

  program
    .command("tui")
    .description(
      "interactive dashboard: browse flags, mark and change targeting",
    )
    .option("--tag <tag>", "only flags with this tag")
    .option("--prefix <prefix>", "only flags whose name starts with this")
    .option("-e, --env <env>", ENV_HELP, collect, [])
    .option("--write", "enable writes from the TUI (read-only without it)")
    .addHelpText(
      "after",
      `
Keys:
  up/down move, left/right or tab change the environment column,
  space marks, enter opens a flag, r refreshes, q quits.
  Write keys (needs --write): o on for everyone, f off,
  a add the HARNESS_FME_KEY key, x remove it, acting on the marked
  flags, or the selected flag, in the focused environment.
  A production environment asks for its exact name, typed out.`,
    )
    .action(action(async (ctx, command) => runTui(ctx, command.opts())))

  const key = program
    .command("key")
    .description("add or remove an individual key on a treatment")
  for (const verb of ["add", "remove"] as const) {
    writeOptions(
      key
        .command(`${verb} [flags...]`)
        .description(
          verb === "add"
            ? "add a key to a treatment (default: on) of each flag"
            : "remove a key from a treatment (default: on) of each flag",
        )
        .option("--key <id>", "the key to use (default: HARNESS_FME_KEY)")
        .option("--treatment <name>", "treatment to edit", "on"),
    )
      .addHelpText("after", WRITE_EPILOGUE)
      .action(
        action<[string[]]>(async (ctx, command, flags) => {
          const opts = command.opts<
            WriteOptions & { key?: string; treatment: string }
          >()
          const keyId = opts.key ?? deps.env.HARNESS_FME_KEY
          if (!keyId)
            throw new CliError("pass --key <id> (or set HARNESS_FME_KEY)", 2)
          const make = verb === "add" ? addKeyOperation : removeKeyOperation
          return runWrite(ctx, {
            flags,
            options: opts,
            operation: make({ key: keyId, treatment: opts.treatment }),
          })
        }),
      )
  }

  for (const verb of ["on", "off"] as const) {
    writeOptions(
      program
        .command(`${verb} [flags...]`)
        .description(
          verb === "on"
            ? "serve on: to everyone by default, to a percentage, or to a segment"
            : "serve off: to everyone by default, or stop serving a segment",
        )
        .option(
          "--segment <name>",
          "act on this segment's membership of the on treatment",
        )
        .addOption(
          new Option(
            "--percent <n>",
            "serve on to this share of traffic, the rest off",
          ).conflicts("segment"),
        ),
    )
      .addHelpText("after", WRITE_EPILOGUE)
      .action(
        action<[string[]]>(async (ctx, command, flags) => {
          const opts = command.opts<
            WriteOptions & { segment?: string; percent?: string }
          >()
          if (verb === "off" && opts.percent !== undefined)
            throw new CliError(
              "--percent only applies to on; use `off` for 0%",
              2,
            )
          let operation: FlagOperation
          try {
            operation =
              verb === "on"
                ? turnOnOperation({
                    segment: opts.segment,
                    percent:
                      opts.percent === undefined
                        ? undefined
                        : Number(opts.percent),
                  })
                : turnOffOperation({ segment: opts.segment })
          } catch (e) {
            throw new CliError(e instanceof Error ? e.message : String(e), 2)
          }
          return runWrite(ctx, { flags, options: opts, operation })
        }),
      )
  }

  return program
}

// Runs the CLI and returns the process exit code. Nothing here exits the
// process, so tests can drive it with fake dependencies.
export const run = async (
  argv: string[],
  deps: Deps = defaultDeps(),
): Promise<number> => {
  let code = 0
  const program = buildProgram(deps, (c) => {
    code = c
  })
  try {
    await program.parseAsync(argv, { from: "user" })
    return code
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode
    if (e instanceof CliError) {
      deps.writeError(`error: ${e.message}\n`)
      return e.exitCode
    }
    deps.writeError(
      `error: ${e instanceof Error ? e.message : "unexpected failure"}\n`,
    )
    return 1
  }
}
