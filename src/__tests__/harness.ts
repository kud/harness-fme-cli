import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "vitest"
import { run } from "../cli.js"
import { type Deps } from "../context.js"
import {
  PROD_ENV,
  QA_ENV,
  flagNamed,
  makeDefinition,
  makeFakeApi,
  type FakeApiOptions,
} from "./fake-api.js"

export const API_KEY = "super-secret-key-xyz"
export const KEY_ID = "0a1b2c3d-0000-4000-8000-000000000001"

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true })
})

export const fixtureApi = (options: FakeApiOptions = {}) => {
  const def = (name: string, overrides = {}) =>
    makeDefinition({ name, ...overrides })
  return makeFakeApi({
    flags: [
      flagNamed("checkout_new_flow", { tags: [{ name: "payments" }] }),
      flagNamed("checkout_banner", { tags: [{ name: "payments" }] }),
      flagNamed("search_rewrite"),
      flagNamed("checkout_legacy", { status: "ARCHIVED" }),
    ],
    definitions: {
      [`${QA_ENV.id}/checkout_new_flow`]: def("checkout_new_flow"),
      [`${QA_ENV.id}/checkout_banner`]: def("checkout_banner", {
        defaultRule: [{ treatment: "on", size: 100 }],
      }),
      [`${QA_ENV.id}/search_rewrite`]: def("search_rewrite"),
      [`${PROD_ENV.id}/checkout_new_flow`]: def("checkout_new_flow"),
      [`${PROD_ENV.id}/checkout_banner`]: def("checkout_banner", {
        defaultRule: [
          { treatment: "on", size: 30 },
          { treatment: "off", size: 70 },
        ],
      }),
    },
    ...options,
  })
}

export const runCli = async (
  argv: string[],
  {
    api = fixtureApi(),
    env = { HARNESS_FME_API_KEY: API_KEY, HARNESS_FME_KEY: KEY_ID },
    minIntervalMs = 0,
    sleeps,
  }: {
    api?: ReturnType<typeof makeFakeApi>
    env?: Record<string, string | undefined>
    minIntervalMs?: number
    sleeps?: number[]
  } = {},
) => {
  const home = mkdtempSync(join(tmpdir(), "harness-fme-cli-test-"))
  homes.push(home)
  let stdout = ""
  let stderr = ""
  const deps: Deps = {
    env,
    fetch: api.fetch,
    write: (t) => void (stdout += t),
    writeError: (t) => void (stderr += t),
    home,
    now: () => new Date("2026-01-02T03:04:05.678Z"),
    isTTY: false,
    minIntervalMs,
    sleep: async (ms) => {
      sleeps?.push(ms)
    },
  }
  const code = await run(argv, deps)
  const backupFiles = () => {
    const root = join(home, ".harness-fme", "backups")
    if (!existsSync(root)) return []
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }))
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : found.push(join(dir, entry.name))
    }
    walk(root)
    return found
  }
  return { code, stdout, stderr, api, home, backupFiles }
}
