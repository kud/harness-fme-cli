import { join } from "node:path"
import {
  applyChanges,
  buildFlagRows,
  classifyRollout,
  countFlags,
  describeDefaultRule,
  findFlags,
  getFeatureFlag,
  getFlagDefinition,
  planChanges,
  selectUpdates,
  type Environment,
  type EnvironmentView,
  type PlanItem,
} from "@kud/harness-fme"
import { makeBackupWriter, stamp } from "../backup.js"
import {
  CliError,
  must,
  openSession,
  selectEnvironments,
  type Context,
  type Session,
} from "../context.js"
import { mountTui } from "../tui/run.js"
import type { TuiServices } from "../tui/app.js"
import { toDetailView, type WriteRequest } from "../tui/state.js"

export type TuiOptions = {
  tag?: string
  prefix?: string
  env: string[]
  write?: boolean
}

const loadRowsFor = async (
  session: Session,
  filters: TuiOptions,
): ReturnType<TuiServices["loadRows"]> => {
  const { client, workspace } = session
  const environments = await selectEnvironments(session, filters.env)
  const flags = must(
    await findFlags(client, workspace.id, {
      tag: filters.tag,
      prefix: filters.prefix,
    }),
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
  return { rows, environments }
}

const environmentByName = (
  environments: Environment[],
  name: string,
): Environment => {
  const found = environments.find((environment) => environment.name === name)
  if (!found) throw new CliError(`environment not found: ${name}`)
  return found
}

// Real services for the TUI, on the same client and the same backup layout the
// CLI write path uses.
export const makeTuiServices = (
  session: Session,
  filters: TuiOptions,
): TuiServices => {
  const { ctx, client, workspace } = session
  const backupRoot = join(ctx.deps.home, ".harness-fme", "backups")

  return {
    loadRows: () => loadRowsFor(session, filters),
    refresh: () => loadRowsFor(session, filters),
    loadDetail: async (flagName) => {
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
      return toDetailView(flag, views)
    },
    plan: async (request) => {
      const environment = environmentByName(
        await selectEnvironments(session, filters.env),
        request.environment.name,
      )
      return planChanges(client, {
        workspaceId: workspace.id,
        environmentId: environment.id,
        flags: request.targets,
        operation: request.operation,
      })
    },
    apply: async (request, plan) => {
      const environment = environmentByName(
        await selectEnvironments(session, filters.env),
        request.environment.name,
      )
      const selected = selectUpdates(plan)
      if (selected.length === 0) return []
      const backups = makeBackupWriter({
        root: backupRoot,
        runStamp: stamp(ctx.deps.now()),
        environmentName: environment.name,
        workspaceId: workspace.id,
        now: ctx.deps.now,
      })
      const outcome = await applyChanges(client, {
        workspaceId: workspace.id,
        environmentId: environment.id,
        operation: request.operation,
        items: selected,
        title: request.operation.defaultTitle,
        comment: request.operation.defaultComment,
        guard: {
          environmentName: environment.name,
          environmentArg: request.environmentArg,
          go: true,
        },
        backup: backups.write,
      })
      return outcome.results
    },
  }
}

export const runTui = async (
  ctx: Context,
  options: TuiOptions,
): Promise<number> => {
  if (!ctx.deps.isTTY)
    throw new CliError(
      "the TUI needs a terminal: run `harness-fme tui` in an interactive shell",
      2,
    )
  const session = await openSession(ctx)
  await mountTui({
    services: makeTuiServices(session, options),
    config: {
      readOnly: !options.write,
      keyId: ctx.deps.env.HARNESS_FME_KEY,
      workspaceName: session.workspace.name,
    },
  })
  return 0
}
