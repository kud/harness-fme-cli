import { homedir } from "node:os"
import {
  createClient,
  resolveApiKey,
  resolveEnvironment,
  resolveWorkspace,
  getEnvironments,
  type Environment,
  type FmeClient,
  type FmeResult,
  type Workspace,
} from "@kud/harness-fme"
import { makeStyle, type Style } from "./render.js"

// Roughly 20 requests per 10 seconds are shared by the whole organisation, so
// calls are spaced out up front instead of waiting to be told off.
export const REQUEST_SPACING_MS = 550

export type Deps = {
  env: Record<string, string | undefined>
  fetch?: typeof fetch
  write: (text: string) => void
  writeError: (text: string) => void
  home: string
  now: () => Date
  isTTY: boolean
  minIntervalMs: number
  sleep?: (ms: number) => Promise<void>
}

export const defaultDeps = (): Deps => ({
  env: process.env,
  write: (text) => void process.stdout.write(text),
  writeError: (text) => void process.stderr.write(text),
  home: homedir(),
  now: () => new Date(),
  isTTY: Boolean(process.stdout.isTTY),
  minIntervalMs: REQUEST_SPACING_MS,
})

export type GlobalOptions = {
  workspace?: string
  json?: boolean
  color?: boolean
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message)
  }
}

export const must = <T>(result: FmeResult<T>): T => {
  if (!result.ok) throw new CliError(result.message)
  return result.data
}

export type Context = {
  deps: Deps
  globals: GlobalOptions
  style: Style
  json: boolean
  print: (line?: string) => void
  note: (line: string) => void
}

export const makeContext = (deps: Deps, globals: GlobalOptions): Context => {
  const json = Boolean(globals.json)
  const color =
    !json && globals.color !== false && deps.isTTY && !deps.env.NO_COLOR
  return {
    deps,
    globals,
    style: makeStyle(color),
    json,
    print: (line = "") => deps.write(`${line}\n`),
    // Progress and explanations go to stderr so stdout stays clean for pipes.
    note: (line) => deps.writeError(`${line}\n`),
  }
}

export type Session = {
  ctx: Context
  client: FmeClient
  workspace: Workspace
}

export const openSession = async (ctx: Context): Promise<Session> => {
  const apiKey = resolveApiKey(ctx.deps.env)
  if (!apiKey)
    throw new CliError(
      "no API key: set HARNESS_FME_API_KEY (MCP_HARNESS_FME_API_KEY works too)",
      2,
    )
  const client = createClient({
    apiKey,
    fetch: ctx.deps.fetch,
    minIntervalMs: ctx.deps.minIntervalMs,
    maxRetries: 6,
    sleep: ctx.deps.sleep,
    onRateLimit: (waitMs) =>
      ctx.note(`rate limited, waiting ${Math.ceil(waitMs / 1000)}s`),
  })
  const reference =
    ctx.globals.workspace ?? ctx.deps.env.HARNESS_FME_WORKSPACE ?? undefined
  const workspace = must(await resolveWorkspace(client, reference))
  return { ctx, client, workspace }
}

const splitList = (values: string[]) =>
  values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)

// Read commands take any number of environments, or all of them when none is
// named.
export const selectEnvironments = async (
  session: Session,
  names: string[],
): Promise<Environment[]> => {
  const all = must(
    await getEnvironments(session.client, {
      workspaceId: session.workspace.id,
    }),
  )
  const wanted = splitList(names)
  if (wanted.length === 0) return all
  return wanted.map((name) => {
    const found = all.find(
      (e) =>
        e.id === name ||
        e.name === name ||
        e.name.toLowerCase() === name.toLowerCase(),
    )
    if (!found)
      throw new CliError(
        `environment not found: ${name}. Available: ${all.map((e) => e.name).join(", ") || "none"}`,
        2,
      )
    return found
  })
}

export const selectOneEnvironment = async (
  session: Session,
  name: string,
): Promise<Environment> =>
  must(await resolveEnvironment(session.client, session.workspace.id, name))

export { splitList }
