import {
  compareFlagEnvironments,
  describeRule,
  type ComparedField,
  type EnvironmentDefinition,
} from "@kud/harness-fme"
import {
  must,
  openSession,
  selectEnvironments,
  type Context,
} from "../context.js"
import { renderTable } from "../render.js"

type Row = {
  label: string
  field?: ComparedField
  cell: (view: EnvironmentDefinition) => string
}

const treatmentsCell = (view: EnvironmentDefinition) =>
  view.treatments
    .map((t) => {
      const parts = [
        t.keys > 0 ? `${t.keys} key${t.keys === 1 ? "" : "s"}` : "",
        ...t.segments,
      ].filter(Boolean)
      return parts.length > 0 ? `${t.name} (${parts.join(", ")})` : t.name
    })
    .join(", ") || "-"

const ROWS: Row[] = [
  {
    label: "DEFINED",
    field: "defined",
    cell: (v) => (v.defined ? "yes" : "no"),
  },
  {
    label: "KILLED",
    field: "killed",
    cell: (v) => (v.killed === null ? "-" : v.killed ? "yes" : "no"),
  },
  {
    label: "DEFAULT RULE",
    field: "defaultRule",
    cell: (v) => (v.defined ? v.defaultRuleText : "-"),
  },
  {
    label: "DEFAULT TREATMENT",
    field: "defaultTreatment",
    cell: (v) => v.defaultTreatment ?? "-",
  },
  {
    label: "TRAFFIC",
    field: "trafficAllocation",
    cell: (v) =>
      v.trafficAllocation === null ? "-" : `${v.trafficAllocation}%`,
  },
  { label: "TREATMENTS", field: "treatments", cell: treatmentsCell },
  {
    label: "RULES",
    field: "rules",
    cell: (v) => (v.defined ? String(v.rules.length) : "-"),
  },
  { label: "UPDATED", cell: (v) => v.lastUpdateTimeIso ?? "-" },
]

export const runCompare = async (
  ctx: Context,
  flagName: string,
  filters: { env: string[] },
): Promise<number> => {
  const session = await openSession(ctx)
  const environments = await selectEnvironments(session, filters.env)
  const comparison = must(
    await compareFlagEnvironments(session.client, {
      workspaceId: session.workspace.id,
      flagName,
      environments,
    }),
  )

  if (ctx.json) {
    ctx.print(
      JSON.stringify(
        {
          flag: comparison.flag,
          differences: comparison.differences,
          environments: comparison.environments.map(
            ({ definition: _definition, ...view }) => view,
          ),
        },
        null,
        2,
      ),
    )
    return 0
  }

  const differs = new Set(comparison.differences)
  // A marker column carries the difference; colour only backs it up.
  ctx.print(ctx.style.bold(comparison.flag))
  ctx.print()
  ctx.print(
    renderTable(
      [
        "",
        "FIELD",
        ...comparison.environments.map((e) => e.environment.toUpperCase()),
      ],
      ROWS.map((row) => {
        const different = row.field !== undefined && differs.has(row.field)
        const paint = different ? ctx.style.yellow : (s: string) => s
        return [
          different ? "*" : "",
          row.label,
          ...comparison.environments.map((v) => paint(row.cell(v))),
        ]
      }),
      ctx.style,
    ),
  )

  const withRules = comparison.environments.filter((v) => v.rules.length > 0)
  if (withRules.length > 0) {
    ctx.print()
    for (const view of withRules) {
      ctx.print(`${ctx.style.bold(view.environment)} rules:`)
      view.rules.forEach((rule, i) =>
        ctx.print(`  ${i + 1}. ${describeRule(rule)}`),
      )
    }
  }

  ctx.print()
  ctx.print(
    comparison.differences.length === 0
      ? "Same in every environment."
      : `* differs: ${comparison.differences.join(", ")}`,
  )
  return 0
}
