import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import React from "react"
import { cleanup, render } from "ink-testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { API_KEY, KEY_ID, fixtureApi, runCli } from "./harness.js"
import { PROD_ENV, QA_ENV, type FakeApiOptions } from "./fake-api.js"
import { makeContext, openSession, type Deps } from "../context.js"
import { makeTuiServices } from "../commands/tui.js"
import { TuiApp } from "../tui/app.js"

const homes: string[] = []
afterEach(() => {
  cleanup()
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true })
})

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

const DOWN = "\u001b[B"
const RIGHT = "\u001b[C"
const ESC = "\u001b"

const backupFiles = (home: string) => {
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

// Real services over the fake API, wired exactly as the command does.
const setupTui = async (
  options: {
    readOnly?: boolean
    apiOptions?: FakeApiOptions
    keyId?: string
  } = {},
) => {
  const api = fixtureApi(options.apiOptions)
  const home = mkdtempSync(join(tmpdir(), "harness-fme-tui-test-"))
  homes.push(home)
  const deps: Deps = {
    env: {
      HARNESS_FME_API_KEY: API_KEY,
      ...(options.keyId === undefined
        ? {}
        : { HARNESS_FME_KEY: options.keyId }),
    },
    fetch: api.fetch,
    write: () => {},
    writeError: () => {},
    home,
    now: () => new Date("2026-01-02T03:04:05.678Z"),
    isTTY: true,
    minIntervalMs: 0,
  }
  const session = await openSession(makeContext(deps, {}))
  return {
    api,
    home,
    services: makeTuiServices(session, { env: [] }),
    config: {
      readOnly: options.readOnly ?? false,
      keyId: deps.env.HARNESS_FME_KEY,
      workspaceName: session.workspace.name,
    },
  }
}

const boot = async (
  options?: Parameters<typeof setupTui>[0],
): Promise<{
  instance: ReturnType<typeof render>
  api: ReturnType<typeof fixtureApi>
  home: string
}> => {
  const setup = await setupTui(options)
  const instance = render(
    <TuiApp services={setup.services} config={setup.config} />,
  )
  await wait()
  return { instance, api: setup.api, home: setup.home }
}

describe("read-only mode", () => {
  it("issues zero PUTs even when the write keys are pressed", async () => {
    const { instance, api } = await boot({ readOnly: true })
    for (const key of ["o", "f", "a", "x"]) {
      instance.stdin.write(key)
      await wait(20)
    }
    expect(instance.lastFrame()).toContain("read-only: start with --write")
    expect(api.puts()).toHaveLength(0)
  })
})

describe("the list screen", () => {
  it("names the workspace and shows the key hints", async () => {
    const { instance } = await boot()
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("harness-fme")
    expect(frame).toContain("Default")
    expect(frame).toMatch(/move/)
    expect(frame).toMatch(/q quit/)
  })

  it("never focuses a production environment, even when Prod comes first", async () => {
    const { instance } = await boot({
      apiOptions: { environments: [PROD_ENV, QA_ENV] },
    })
    const frame = instance.lastFrame() ?? ""
    expect(frame).toMatch(/▸\s*QA/)
    expect(frame).not.toMatch(/▸\s*Prod/)
  })

  it("marks several flags and plans all of them", async () => {
    const { instance, api } = await boot()
    const { stdin, lastFrame } = instance
    stdin.write(" ")
    await wait(20)
    stdin.write(DOWN)
    await wait(20)
    stdin.write(DOWN)
    await wait(20)
    stdin.write(" ")
    await wait(20)
    expect(lastFrame()).toContain("2 marked")
    stdin.write("o")
    await wait()
    expect(lastFrame()).toMatch(/2 changes, 0 skipped/)
    stdin.write("y")
    await wait()
    expect(api.puts()).toHaveLength(2)
  })
})

describe("writes in QA", () => {
  it("shows the plan counts, applies on y, backs up before the PUT and reads back", async () => {
    let backupsAtPut = -1
    const { instance, api, home } = await boot({
      apiOptions: {
        afterWrite: (flag, stored) => {
          backupsAtPut = backupFiles(home).length
          return stored
        },
      },
    })
    const { stdin, lastFrame } = instance
    stdin.write("o")
    await wait()
    expect(lastFrame()).toMatch(/1 changes, 0 skipped/)
    stdin.write("y")
    await wait()
    expect(api.puts()).toHaveLength(1)
    expect(backupsAtPut).toBe(1)
    expect(backupFiles(home)).toHaveLength(1)
    const stored = api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!
    expect(stored.defaultRule).toEqual([{ treatment: "on", size: 100 }])
    expect(lastFrame()).toContain("applied")
  })

  it("moves the selection with the arrow keys and applies to that flag", async () => {
    const { instance, api } = await boot()
    const { stdin, lastFrame } = instance
    stdin.write(DOWN)
    await wait(20)
    stdin.write(DOWN)
    await wait(20)
    stdin.write("o")
    await wait()
    expect(lastFrame()).toContain("search_rewrite")
    stdin.write("y")
    await wait()
    expect(api.puts()).toHaveLength(1)
    expect(api.puts()[0].path).toContain("search_rewrite")
  })

  it("cancels with esc and issues no request", async () => {
    const { instance, api } = await boot()
    const { stdin, lastFrame } = instance
    stdin.write("o")
    await wait()
    stdin.write(ESC)
    await wait(20)
    expect(api.puts()).toHaveLength(0)
    expect(lastFrame()).toMatch(/checkout_new_flow\s+Ramping/)
  })

  it("opens a flag's definitions with enter and goes back with esc", async () => {
    const { instance } = await boot()
    const { stdin, lastFrame } = instance
    stdin.write("\r")
    await wait()
    const detail = lastFrame() ?? ""
    expect(detail).toContain("checkout_new_flow")
    expect(detail).toContain("keys")
    expect(detail).toContain("segments")
    stdin.write(ESC)
    await wait(20)
    expect(lastFrame()).toMatch(/checkout_new_flow\s+Ramping/)
  })

  it("quits with q", async () => {
    const { services, config } = await setupTui()
    const exits: number[] = []
    const instance = render(
      <TuiApp
        services={services}
        config={config}
        onExit={() => void exits.push(1)}
      />,
    )
    await wait()
    instance.stdin.write("q")
    await wait(20)
    expect(exits).toHaveLength(1)
  })
})

describe("writes against production", () => {
  const focusProdAndWrite = async (options: FakeApiOptions = {}) => {
    const { instance, api, home } = await boot({ apiOptions: options })
    const { stdin, lastFrame } = instance
    await wait()
    stdin.write(RIGHT)
    await wait(20)
    stdin.write("o")
    await wait()
    return { instance, api, home, confirmation: lastFrame() ?? "" }
  }

  it("shows the production confirmation for a write key on Prod", async () => {
    const { confirmation } = await focusProdAndWrite()
    expect(confirmation).toContain("is a production environment")
    expect(confirmation).toContain("type the environment name exactly")
  })

  it("never writes a wrong or case-different name", async () => {
    for (const typed of ["prod", "PROD"]) {
      const { instance, api } = await focusProdAndWrite()
      instance.stdin.write(typed)
      await wait(20)
      instance.stdin.write("\r")
      await wait()
      expect(api.puts()).toHaveLength(0)
      expect(instance.lastFrame()).toContain("looks like production")
    }
  })

  it("writes once, one backup before the PUT, when the exact name is typed", async () => {
    const backupsAtPut: number[] = []
    const { instance, api, home } = await focusProdAndWrite({
      afterWrite: (flag, stored) => {
        backupsAtPut.push(backupFiles(home).length)
        return stored
      },
    })
    instance.stdin.write("Prod")
    await wait(20)
    instance.stdin.write("\r")
    await wait()
    expect(api.puts()).toHaveLength(1)
    expect(api.puts()[0].path).toContain(PROD_ENV.id)
    expect(backupsAtPut).toEqual([1])
    expect(backupFiles(home)).toHaveLength(1)
    expect(instance.lastFrame()).toContain("applied")
  })

  it("cancels the confirmation with esc", async () => {
    const { instance, api } = await focusProdAndWrite()
    instance.stdin.write(ESC)
    await wait(20)
    expect(api.puts()).toHaveLength(0)
    expect(instance.lastFrame()).toMatch(/checkout_new_flow\s+Ramping/)
  })
})

describe("the tui command", () => {
  it("documents its options", async () => {
    const { code, stdout } = await runCli(["tui", "--help"])
    expect(code).toBe(0)
    for (const option of ["--env", "--tag", "--prefix", "--write"])
      expect(stdout).toContain(option)
    expect(stdout).toContain("exact name")
  })

  it("refuses to start when stdout is not a TTY", async () => {
    const { code, stderr, api } = await runCli(["tui"])
    expect(code).toBe(2)
    expect(stderr).toContain("terminal")
    expect(api.calls).toHaveLength(0)
  })
})
