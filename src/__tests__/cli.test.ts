import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { defaultDeps } from "../context.js"
import { API_KEY, KEY_ID, fixtureApi, runCli } from "./harness.js"
import { PROD_ENV, QA_ENV, makeDefinition } from "./fake-api.js"

describe("help", () => {
  it("lists every command", async () => {
    const { code, stdout } = await runCli(["--help"])
    expect(code).toBe(0)
    for (const command of [
      "list",
      "status",
      "compare",
      "history",
      "unreleased",
      "key",
      "on",
      "off",
    ])
      expect(stdout).toContain(command)
    expect(stdout).toContain("HARNESS_FME_API_KEY")
  })

  it("documents the write safety on a write command", async () => {
    const { stdout } = await runCli(["key", "add", "--help"])
    expect(stdout).toContain("--go")
    expect(stdout).toContain("--only")
    expect(stdout).toContain("--limit")
    expect(stdout).toContain("exact name")
  })
})

describe("auth", () => {
  it("fails clearly without a key", async () => {
    const { code, stderr, api } = await runCli(["list"], { env: {} })
    expect(code).toBe(2)
    expect(stderr).toContain("no API key")
    expect(api.calls).toHaveLength(0)
  })

  it("accepts the MCP variable name", async () => {
    const { code } = await runCli(["list"], {
      env: { MCP_HARNESS_FME_API_KEY: API_KEY },
    })
    expect(code).toBe(0)
  })

  it("never prints the key, on success or on failure", async () => {
    const ok = await runCli(["list", "--json"])
    const failing = await runCli(["list"], {
      api: Object.assign(fixtureApi(), {
        fetch: (async () =>
          new Response("denied", { status: 401 })) as typeof fetch,
      }),
    })
    for (const out of [ok.stdout, ok.stderr, failing.stdout, failing.stderr])
      expect(out).not.toContain(API_KEY)
    expect(failing.code).toBe(1)
  })
})

describe("list", () => {
  it("shows rollout and the default rule per environment", async () => {
    const { code, stdout } = await runCli(["list"])
    expect(code).toBe(0)
    expect(stdout).toContain("QA")
    expect(stdout).toContain("PROD")
    expect(stdout).toMatch(
      /checkout_banner\s+Ramping\s+on 100%\s+on 30% \/ off 70%/,
    )
    expect(stdout).toMatch(/search_rewrite\s+Ramping\s+off 100%\s+-/)
    expect(stdout).not.toContain("checkout_legacy")
  })

  it("filters by tag, prefix and environment", async () => {
    const byTag = await runCli(["list", "--tag", "payments", "--env", "qa"])
    expect(byTag.stdout).toContain("checkout_new_flow")
    expect(byTag.stdout).not.toContain("search_rewrite")
    expect(byTag.stdout).not.toContain("PROD")
    const byPrefix = await runCli(["list", "--prefix", "search"])
    expect(byPrefix.stdout).toContain("search_rewrite")
    expect(byPrefix.stdout).not.toContain("checkout")
  })

  it("emits JSON", async () => {
    const { stdout } = await runCli(["list", "--json", "--env", "QA"])
    const rows = JSON.parse(stdout)
    expect(rows).toHaveLength(3)
    expect(rows[0].environments[0]).toMatchObject({ environment: "QA" })
  })
})

describe("status", () => {
  it("shows every environment for one flag", async () => {
    const { code, stdout } = await runCli(["status", "checkout_banner"])
    expect(code).toBe(0)
    expect(stdout).toContain("checkout_banner")
    expect(stdout).toMatch(/QA\s+on\s+on 100%/)
    expect(stdout).toMatch(/Prod\s+partial\s+on 30% \/ off 70%/)
  })

  it("says when a flag is not defined in an environment", async () => {
    const { stdout } = await runCli(["status", "search_rewrite"])
    expect(stdout).toMatch(/Prod\s+not defined/)
  })
})

describe("unreleased", () => {
  it("lists flags that are not fully on", async () => {
    const { code, stdout } = await runCli(["unreleased", "--env", "QA"])
    expect(code).toBe(0)
    expect(stdout).toContain("checkout_new_flow")
    expect(stdout).toContain("search_rewrite")
    expect(stdout).not.toContain("checkout_banner")
    expect(stdout).toContain("2 flags not fully on")
  })

  it("needs an environment", async () => {
    const { code, stderr } = await runCli(["unreleased"])
    expect(code).toBe(2)
    expect(stderr).toContain("--env")
  })
})

describe("writes are a plan until --go", () => {
  it("shows the plan and writes nothing", async () => {
    const { code, stdout, api, backupFiles } = await runCli([
      "key",
      "add",
      "checkout_new_flow",
      "search_rewrite",
      "--env",
      "QA",
    ])
    expect(code).toBe(0)
    expect(stdout).toContain("add key to on")
    expect(stdout).toContain("Dry run: nothing was written")
    expect(api.puts()).toHaveLength(0)
    expect(backupFiles()).toHaveLength(0)
  })

  it("with --go: saves the original, writes with title and comment, reads back", async () => {
    const { code, stdout, api, backupFiles } = await runCli([
      "key",
      "add",
      "checkout_new_flow",
      "--env",
      "QA",
      "--go",
    ])
    expect(code).toBe(0)
    expect(stdout).toContain("applied  checkout_new_flow")
    expect(api.puts()).toHaveLength(1)
    const body = api.puts()[0].body as Record<string, unknown>
    expect(body.title).toBeTruthy()
    expect(body.comment).toBeTruthy()
    expect(api.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["PUT"]),
    )
    const stored = api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!
    expect(stored.treatments[0].keys).toEqual([KEY_ID])

    const files = backupFiles()
    expect(files).toHaveLength(1)
    const saved = JSON.parse(readFileSync(files[0], "utf8"))
    expect(saved).toMatchObject({
      environment: "QA",
      flag: "checkout_new_flow",
    })
    expect(saved.definition.treatments[0].keys).toBeUndefined()
  })

  it("takes the title and comment from the caller", async () => {
    const { api } = await runCli([
      "key",
      "add",
      "checkout_new_flow",
      "--env",
      "QA",
      "--go",
      "--title",
      "My title",
      "--comment",
      "My comment",
    ])
    expect(api.puts()[0].body).toMatchObject({
      title: "My title",
      comment: "My comment",
    })
  })

  it("restricts a write with --only and --limit", async () => {
    const only = await runCli([
      "key",
      "add",
      "--prefix",
      "checkout",
      "--env",
      "QA",
      "--only",
      "checkout_new_flow",
      "--go",
    ])
    expect(only.api.puts()).toHaveLength(1)
    expect(only.api.puts()[0].path).toContain("/checkout_new_flow/")

    const limited = await runCli([
      "key",
      "add",
      "checkout_new_flow",
      "search_rewrite",
      "--env",
      "QA",
      "--limit",
      "1",
      "--go",
    ])
    expect(limited.api.puts()).toHaveLength(1)
  })

  it("rejects --only naming a flag outside the run", async () => {
    const { code, api } = await runCli([
      "key",
      "add",
      "checkout_new_flow",
      "--env",
      "QA",
      "--only",
      "search_rewrite",
      "--go",
    ])
    expect(code).toBe(2)
    expect(api.puts()).toHaveLength(0)
  })

  it("stops at the first failure and says what was left", async () => {
    const api = fixtureApi({ failPutFor: ["checkout_new_flow"] })
    const {
      code,
      stdout,
      api: used,
    } = await runCli(
      [
        "key",
        "add",
        "checkout_new_flow",
        "search_rewrite",
        "--env",
        "QA",
        "--go",
      ],
      { api },
    )
    expect(code).toBe(1)
    expect(stdout).toContain("FAILED  checkout_new_flow")
    expect(stdout).toContain("1 not attempted")
    expect(used.puts()).toHaveLength(1)
  })

  it("needs a key id", async () => {
    const { code, stderr } = await runCli(
      ["key", "add", "checkout_new_flow", "--env", "QA"],
      { env: { HARNESS_FME_API_KEY: API_KEY } },
    )
    expect(code).toBe(2)
    expect(stderr).toContain("--key")
  })

  it("removes a key", async () => {
    const api = fixtureApi()
    api.definitions.set(
      `${QA_ENV.id}/checkout_new_flow`,
      makeDefinition({
        name: "checkout_new_flow",
        treatments: [{ name: "on", keys: [KEY_ID] }, { name: "off" }],
      }),
    )
    const { code } = await runCli(
      ["key", "remove", "checkout_new_flow", "--env", "QA", "--go"],
      { api },
    )
    expect(code).toBe(0)
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!.treatments[0].keys,
    ).toBeUndefined()
  })
})

describe("on and off", () => {
  it("turns a flag on for everyone", async () => {
    const { code, api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "QA",
      "--go",
    ])
    expect(code).toBe(0)
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!.defaultRule,
    ).toEqual([{ treatment: "on", size: 100 }])
  })

  it("rolls out to a percentage", async () => {
    const { api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "QA",
      "--percent",
      "20",
      "--go",
    ])
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!.defaultRule,
    ).toEqual([
      { treatment: "on", size: 20 },
      { treatment: "off", size: 80 },
    ])
  })

  it("adds a segment to on, then removes it with off", async () => {
    const api = fixtureApi()
    await runCli(
      [
        "on",
        "checkout_new_flow",
        "--env",
        "QA",
        "--segment",
        "beta_testers",
        "--go",
      ],
      { api },
    )
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!.treatments[0]
        .segments,
    ).toEqual(["beta_testers"])
    await runCli(
      [
        "off",
        "checkout_new_flow",
        "--env",
        "QA",
        "--segment",
        "beta_testers",
        "--go",
      ],
      { api },
    )
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_new_flow`)!.treatments[0]
        .segments,
    ).toBeUndefined()
  })

  it("turns a flag off", async () => {
    const { code, api } = await runCli([
      "off",
      "checkout_banner",
      "--env",
      "QA",
      "--go",
    ])
    expect(code).toBe(0)
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_banner`)!.defaultRule,
    ).toEqual([{ treatment: "off", size: 100 }])
  })

  it("refuses a segment together with a percentage", async () => {
    const { code, api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "QA",
      "--segment",
      "x",
      "--percent",
      "5",
      "--go",
    ])
    expect(code).not.toBe(0)
    expect(api.puts()).toHaveLength(0)
  })

  it("rejects a bad percentage before touching the API", async () => {
    const { code, stderr, api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "QA",
      "--percent",
      "150",
      "--go",
    ])
    expect(code).toBe(2)
    expect(stderr).toContain("percent")
    expect(api.calls).toHaveLength(0)
  })

  it("requires --env", async () => {
    const { code, api } = await runCli(["on", "checkout_new_flow", "--go"])
    expect(code).not.toBe(0)
    expect(api.puts()).toHaveLength(0)
  })
})

describe("production environments", () => {
  it("plans against production without --go", async () => {
    const { code, stdout, api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "Prod",
    ])
    expect(code).toBe(0)
    expect(stdout).toContain("(production)")
    expect(api.puts()).toHaveLength(0)
  })

  it("refuses --go unless the exact environment name was typed", async () => {
    for (const arg of ["prod", PROD_ENV.id]) {
      const { code, stderr, api } = await runCli([
        "on",
        "checkout_new_flow",
        "--env",
        arg,
        "--go",
      ])
      expect(code).toBe(2)
      expect(stderr).toContain("looks like production")
      expect(api.puts()).toHaveLength(0)
      expect(
        api.calls.filter((c) => c.path.includes("/checkout_new_flow/")),
      ).toHaveLength(0)
    }
  })

  it("writes when the exact name and --go are both given", async () => {
    const { code, api } = await runCli([
      "on",
      "checkout_new_flow",
      "--env",
      "Prod",
      "--go",
    ])
    expect(code).toBe(0)
    expect(api.puts()).toHaveLength(1)
    expect(api.puts()[0].path).toContain(PROD_ENV.id)
  })
})

describe("rate limiting", () => {
  it("spaces calls about 550 ms apart by default", () => {
    expect(defaultDeps().minIntervalMs).toBe(550)
  })

  it("waits between requests when spacing is on", async () => {
    const sleeps: number[] = []
    await runCli(["status", "checkout_banner"], { minIntervalMs: 550, sleeps })
    expect(sleeps.length).toBeGreaterThan(0)
  })
})
