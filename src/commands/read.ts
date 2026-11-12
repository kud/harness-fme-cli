import {
  buildFlagRows,
  countFlags,
  findFlags,
  getFeatureFlag,
  getFlagDefinition,
  classifyRollout,
  describeDefaultRule,
  type EnvironmentView,
  type FlagRow,
} from "@kud/harness-fme"
import {
  CliError,
  must,
  openSession,
  selectEnvironments,
  type Context,
  type Session,
} from "../context.js"
import { plural, renderTable, stateCell } from "../render.js"

export type ReadFilters = {
  tag?: string
  prefix?: string
  env: string[]
  all?: boolean
}

const loadRows = async (
  session: Session,
  filters: ReadFilters,
): Promise<{ rows: FlagRow[]; environments: string[] }> => {
  const { ctx, client, workspace } = session
  const environments = await selectEnvironments(session, filters.env)
  const flags = must(
    await findFlags(client, workspace.id, {
      tag: filters.tag,
      prefix: filters.prefix,
      includeInactive: filters.all,
    }),
  )
  ctx.note(
    `reading ${plural(flags.length, "flag")} across ${plural(environments.length, "environment")}`,
  )
  const total = await countFlags(client, workspace.id)
  const rows = must(
    await buildFlagRows(client, {
      workspaceId: workspace.id,
      flags,
      environments,
      totalFlags: total.ok ? total.data : flags.length,
    }),
  )
  return { rows, environments: environments.map((e) => e.name) }
}

const toJson = (rows: FlagRow[]) =>
  rows.map((row) => ({
    flag: row.flag,
    rolloutStatus: row.rolloutStatus ?? null,
    environments: row.environments.map((e) => ({
      environment: e.environment,
      state: e.state,
      defaultRule: e.defaultRule,
    })),
  }))

export const runList = async (
  ctx: Context,
  filters: ReadFilters,
): Promise<number> => {
  const session = await openSession(ctx)
  const { rows, environments } = await loadRows(session, filters)
  if (ctx.json) {
    ctx.print(JSON.stringify(toJson(rows), null, 2))
    return 0
  }
  if (rows.length === 0) {
    ctx.print("No flags match.")
    return 0
  }
  ctx.print(
    renderTable(
      ["FLAG", "ROLLOUT", ...environments.map((e) => e.toUpperCase())],
      rows.map((row) => [
        row.flag,
        row.rolloutStatus ?? "-",
        ...row.environments.map((e) => stateCell(e, ctx.style)),
      ]),
      ctx.style,
    ),
  )
  ctx.print()
  ctx.print(plural(rows.length, "flag"))
  return 0
}

export const runUnreleased = async (
  ctx: Context,
  filters: ReadFilters,
): Promise<number> => {
  if (filters.env.length === 0)
    throw new CliError("pass --env <environment>", 2)
  const session = await openSession(ctx)
  const { rows, environments } = await loadRows(session, filters)
  const defined = rows.filter((r) =>
    r.environments.every((e) => e.state !== "undefined"),
  )
  const unreleased = defined.filter((r) =>
    r.environments.some((e) => e.state !== "on"),
  )
  const undefinedCount = rows.length - defined.length
  if (ctx.json) {
    ctx.print(JSON.stringify(toJson(unreleased), null, 2))
    return 0
  }
  if (unreleased.length === 0) ctx.print("Every flag is fully on.")
  else {
    ctx.print(
      renderTable(
        ["FLAG", "ROLLOUT", ...environments.map((e) => e.toUpperCase())],
        unreleased.map((row) => [
          row.flag,
          row.rolloutStatus ?? "-",
          ...row.environments.map((e) => stateCell(e, ctx.style)),
        ]),
        ctx.style,
      ),
    )
    ctx.print()
  }
  ctx.print(
    `${plural(unreleased.length, "flag")} not fully on${
      undefinedCount > 0
        ? `; ${plural(undefinedCount, "flag")} not defined in ${environments.join(", ")}`
        : ""
    }`,
  )
  return 0
}

const treatmentsSummary = (view: EnvironmentView) => {
  const def = view.definition
  if (!def) return { keys: 0, segments: [] as string[], rules: 0, traffic: "-" }
  const keys = def.treatments.reduce((n, t) => n + (t.keys?.length ?? 0), 0)
  const segments = [...new Set(def.treatments.flatMap((t) => t.segments ?? []))]
  return {
    keys,
    segments,
    rules: def.rules?.length ?? 0,
    traffic:
      def.trafficAllocation === undefined ? "-" : `${def.trafficAllocation}%`,
  }
}

export const runStatus = async (
  ctx: Context,
  flagName: string,
  filters: { env: string[] },
): Promise<number> => {
  const session = await openSession(ctx)
  const { client, workspace } = session
  const flag = must(
    await getFeatureFlag(client, { workspaceId: workspace.id, flagName }),
  )
  const environments = await selectEnvironments(session, filters.env)
  const views: EnvironmentView[] = []
  for (const environment of environments) {
    const read = await getFlagDefinition(client, {
      workspaceId: workspace.id,
      environmentId: environment.id,
      flagName,
    })
    if (read.ok)
      views.push({
        environment: environment.name,
        definition: read.data,
        state: classifyRollout(read.data),
        defaultRule: describeDefaultRule(read.data),
      })
    else if (read.status === 404)
      views.push({
        environment: environment.name,
        state: "undefined",
        defaultRule: "none",
      })
    else throw new CliError(read.message)
  }

  if (ctx.json) {
    ctx.print(
      JSON.stringify(
        {
          flag: flag.name,
          rolloutStatus: flag.rolloutStatus?.name ?? null,
          tags: (flag.tags ?? []).map((t) => t.name),
          environments: views.map((v) => ({
            environment: v.environment,
            state: v.state,
            defaultRule: v.defaultRule,
            ...treatmentsSummary(v),
          })),
        },
        null,
        2,
      ),
    )
    return 0
  }

  const tags = (flag.tags ?? []).map((t) => t.name)
  ctx.print(
    `${ctx.style.bold(flag.name)}  ${flag.rolloutStatus?.name ?? "no rollout status"}${
      tags.length > 0 ? `  [${tags.join(", ")}]` : ""
    }`,
  )
  if (flag.description) ctx.print(ctx.style.dim(flag.description))
  ctx.print()
  ctx.print(
    renderTable(
      ["ENV", "STATE", "DEFAULT RULE", "TRAFFIC", "RULES", "KEYS", "SEGMENTS"],
      views.map((view) => {
        const s = treatmentsSummary(view)
        return [
          view.environment,
          view.state === "undefined"
            ? ctx.style.dim("not defined")
            : view.state,
          stateCell(view, ctx.style),
          s.traffic,
          String(s.rules),
          String(s.keys),
          s.segments.join(", ") || "-",
        ]
      }),
      ctx.style,
    ),
  )
  return 0
}
