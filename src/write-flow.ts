import { join } from "node:path"
import {
  applyChanges,
  evaluateWriteGate,
  findFlags,
  isProductionEnvironment,
  planChanges,
  selectUpdates,
  type ApplyResult,
  type FlagOperation,
} from "@kud/harness-fme"
import { makeBackupWriter, stamp } from "./backup.js"
import {
  CliError,
  must,
  openSession,
  selectOneEnvironment,
  splitList,
  type Context,
} from "./context.js"
import { actionCell, plural, planDetail, renderTable } from "./render.js"

export type WriteOptions = {
  env: string
  prefix?: string
  only?: string[]
  limit?: string
  go?: boolean
  title?: string
  comment?: string
  backupDir?: string
}

const parseLimit = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0)
    throw new CliError("--limit must be a whole number, 0 or more", 2)
  return n
}

// The one path every write takes: resolve, plan, show the plan, and only with
// --go back up, write and verify, stopping at the first failure.
export const runWrite = async (
  ctx: Context,
  {
    flags,
    options,
    operation,
  }: { flags: string[]; options: WriteOptions; operation: FlagOperation },
): Promise<number> => {
  if (flags.length === 0 && !options.prefix)
    throw new CliError("name at least one flag, or pass --prefix", 2)
  if (flags.length > 0 && options.prefix)
    throw new CliError("pass flag names or --prefix, not both", 2)
  const limit = parseLimit(options.limit)
  const only = splitList(options.only ?? [])
  const go = Boolean(options.go)

  const session = await openSession(ctx)
  const environment = await selectOneEnvironment(session, options.env)
  const gate = evaluateWriteGate({
    environmentName: environment.name,
    environmentArg: options.env,
    go,
  })
  if (gate.mode === "refused") throw new CliError(gate.reason, 2)

  let targets = flags
  if (options.prefix) {
    const found = must(
      await findFlags(session.client, session.workspace.id, {
        prefix: options.prefix,
      }),
    )
    targets = found.map((f) => f.name)
    if (targets.length === 0)
      throw new CliError(`no active flag starts with ${options.prefix}`)
  }

  ctx.note(`planning ${plural(targets.length, "flag")} in ${environment.name}`)
  const plan = await planChanges(session.client, {
    workspaceId: session.workspace.id,
    environmentId: environment.id,
    flags: targets,
    operation,
  })

  const unknownOnly = only.filter((name) => !targets.includes(name))
  if (unknownOnly.length > 0)
    throw new CliError(
      `--only names flags that are not in this run: ${unknownOnly.join(", ")}`,
      2,
    )
  const selected = selectUpdates(plan, { only, limit })
  const style = ctx.style
  const production = isProductionEnvironment(environment.name)

  if (!ctx.json) {
    ctx.print(
      `${style.bold(operation.describe)} in ${style.bold(environment.name)}${
        production ? style.red("  (production)") : ""
      }`,
    )
    ctx.print()
    ctx.print(
      renderTable(
        ["FLAG", "ACTION", "DETAIL"],
        plan.map((item) => [
          item.flag,
          actionCell(item, style),
          planDetail(item),
        ]),
        style,
      ),
    )
    ctx.print()
  }

  const errors = plan.filter((p) => p.action === "error").length
  const updates = plan.filter((p) => p.action === "update").length
  const toWrite = selected.length

  const emitJson = (
    mode: "plan" | "write",
    results: ApplyResult[],
    backupDir?: string,
  ) =>
    ctx.print(
      JSON.stringify(
        {
          environment: environment.name,
          mode,
          plan: plan.map((p) =>
            p.action === "update"
              ? {
                  flag: p.flag,
                  action: p.action,
                  summary: p.summary,
                  changes: p.changes,
                  selected: selected.some((s) => s.flag === p.flag),
                }
              : p,
          ),
          results,
          ...(backupDir ? { backupDir } : {}),
        },
        null,
        2,
      ),
    )

  if (!go) {
    if (ctx.json) emitJson("plan", [])
    else
      ctx.print(
        toWrite === 0
          ? "Nothing to write."
          : `Dry run: nothing was written. ${plural(toWrite, "change")} ready${
              toWrite < updates
                ? ` (${updates} planned, narrowed by --only/--limit)`
                : ""
            }; re-run with --go to apply${
              production
                ? ` (production needs --env ${environment.name} --go)`
                : ""
            }.`,
      )
    return errors > 0 ? 1 : 0
  }

  if (errors > 0)
    throw new CliError(
      `${plural(errors, "flag")} could not be read; fix that before writing`,
    )
  if (toWrite === 0) {
    if (ctx.json) emitJson("write", [])
    else ctx.print("Nothing to write.")
    return 0
  }

  const backups = makeBackupWriter({
    root: options.backupDir ?? join(ctx.deps.home, ".harness-fme", "backups"),
    runStamp: stamp(ctx.deps.now()),
    environmentName: environment.name,
    workspaceId: session.workspace.id,
    now: ctx.deps.now,
  })

  const live = (result: ApplyResult) => {
    if (ctx.json) return
    const label =
      result.status === "applied"
        ? style.green("applied")
        : result.status === "skipped"
          ? style.dim("skipped")
          : style.red("FAILED")
    ctx.print(
      `${label}  ${result.flag}${result.reason ? `  ${result.reason}` : ""}`,
    )
  }

  const title = options.title ?? operation.defaultTitle
  const comment = options.comment ?? operation.defaultComment
  const outcome = await applyChanges(session.client, {
    workspaceId: session.workspace.id,
    environmentId: environment.id,
    operation,
    items: selected,
    title,
    comment,
    guard: {
      environmentName: environment.name,
      environmentArg: options.env,
      go,
    },
    backup: backups.write,
    onResult: live,
  })

  const applied = outcome.results.filter((r) => r.status === "applied").length
  if (ctx.json) emitJson("write", outcome.results, backups.dir)
  else {
    ctx.print()
    ctx.print(`Originals are saved in ${backups.dir}`)
    if (outcome.ok) ctx.print(`Done: ${plural(applied, "flag")} changed.`)
    else {
      const notAttempted = toWrite - outcome.results.length
      ctx.print(
        `Stopped at the first failure after ${plural(applied, "change")}${
          notAttempted > 0 ? `; ${notAttempted} not attempted` : ""
        }.`,
      )
    }
  }
  return outcome.ok ? 0 : 1
}
