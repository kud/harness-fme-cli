import { getFlagHistory, type FlagChange } from "@kud/harness-fme"
import {
  CliError,
  must,
  openSession,
  selectOneEnvironment,
  type Context,
} from "../context.js"
import { plural, renderTable } from "../render.js"

const formatValue = (value: unknown) =>
  value === undefined ? "-" : JSON.stringify(value)

const changeLines = (change: FlagChange): string[] => {
  if (change.diff === null) return ["(oldest change found, nothing to compare)"]
  if (change.diff.length === 0) return ["(no change to what is served)"]
  return change.diff.map(
    (d) => `${d.path}: ${formatValue(d.before)} -> ${formatValue(d.after)}`,
  )
}

export const runHistory = async (
  ctx: Context,
  flagName: string,
  options: { env: string; limit: string },
): Promise<number> => {
  const limit = Number(options.limit)
  if (!Number.isInteger(limit) || limit < 1)
    throw new CliError("--limit must be a whole number above 0", 2)
  const session = await openSession(ctx)
  const environment = await selectOneEnvironment(session, options.env)
  const history = must(
    await getFlagHistory(session.client, {
      environmentId: environment.id,
      flagName,
      limit,
    }),
  )

  if (ctx.json) {
    ctx.print(
      JSON.stringify(
        {
          flag: flagName,
          environment: environment.name,
          source: "published change requests",
          changes: history.map(
            ({ definition: _definition, ...change }) => change,
          ),
        },
        null,
        2,
      ),
    )
    return 0
  }

  if (history.length === 0) {
    ctx.print(
      `No published change requests for ${flagName} in ${environment.name}.`,
    )
    ctx.note(
      "Only changes made through an approval flow are recorded by the API; direct edits do not appear.",
    )
    return 0
  }

  ctx.print(`${ctx.style.bold(flagName)}  ${environment.name}`)
  ctx.print()
  ctx.print(
    renderTable(
      ["TIME", "TITLE", "CHANGE TYPE", "APPROVERS", "EDITED BY", "STATUS"],
      history.map((c) => [
        c.timeIso ?? "-",
        c.title ?? "-",
        c.changeType ?? "-",
        c.approvers.join(", ") || "-",
        c.editedBy ?? "-",
        c.status ?? "-",
      ]),
      ctx.style,
    ),
  )
  for (const change of history) {
    ctx.print()
    ctx.print(
      `${ctx.style.bold(change.timeIso ?? "-")}  ${change.title ?? change.id}`,
    )
    if (
      change.defaultRuleBefore !== null &&
      change.defaultRuleBefore !== change.defaultRuleAfter
    )
      ctx.print(
        `  default rule: ${change.defaultRuleBefore} -> ${ctx.style.yellow(change.defaultRuleAfter ?? "-")}`,
      )
    for (const line of changeLines(change)) ctx.print(`  ${line}`)
  }
  ctx.print()
  ctx.print(
    `${plural(history.length, "change")}, from published change requests; direct edits without approval are not recorded by the API`,
  )
  return 0
}
