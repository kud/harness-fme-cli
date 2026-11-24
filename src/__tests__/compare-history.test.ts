import { describe, expect, it } from "vitest"
import { fixtureApi, runCli } from "./harness.js"
import { PROD_ENV, QA_ENV, makeDefinition } from "./fake-api.js"

describe("compare", () => {
  it("shows two environments' differing default rules side by side", async () => {
    const { code, stdout } = await runCli(["compare", "checkout_banner"])
    expect(code).toBe(0)
    const ruleLine = stdout.split("\n").find((l) => l.includes("DEFAULT RULE"))
    expect(ruleLine).toMatch(/^\*\s+DEFAULT RULE\s+on 100%\s+on 30% \/ off 70%/)
    expect(stdout).toContain("* differs: defaultRule")
  })

  it("says so when every environment is the same", async () => {
    const { stdout } = await runCli(["compare", "checkout_new_flow"])
    expect(stdout).toContain("Same in every environment.")
  })

  it("shows a missing environment as not defined", async () => {
    const { stdout } = await runCli(["compare", "search_rewrite", "--json"])
    const out = JSON.parse(stdout)
    expect(out.differences).toEqual(["defined"])
    expect(
      out.environments.map((e: { defined: boolean }) => e.defined),
    ).toEqual([true, false])
  })

  it("gives every epoch time an ISO twin in JSON", async () => {
    const api = fixtureApi({
      definitions: {
        [`${QA_ENV.id}/checkout_banner`]: makeDefinition({
          name: "checkout_banner",
          lastUpdateTime: 1_767_323_045_678,
        }),
      },
    })
    const { stdout } = await runCli(
      ["compare", "checkout_banner", "--env", "QA", "--json"],
      { api },
    )
    const [qa] = JSON.parse(stdout).environments
    expect(qa.lastUpdateTime).toBe(1_767_323_045_678)
    expect(qa.lastUpdateTimeIso).toBe("2026-01-02T03:04:05.678Z")
  })

  it("lists each environment's rules on one line", async () => {
    const api = fixtureApi({
      definitions: {
        [`${PROD_ENV.id}/checkout_banner`]: makeDefinition({
          name: "checkout_banner",
          rules: [
            {
              buckets: [{ treatment: "on", size: 100 }],
              condition: {
                combiner: "AND",
                matchers: [{ type: "IN_SEGMENT", string: "beta-testers" }],
              },
            },
          ],
        }),
      },
    })
    const { stdout } = await runCli(["compare", "checkout_banner"], { api })
    expect(stdout).toContain("1. IN_SEGMENT beta-testers -> on 100%")
  })

  it("accepts the workspace by name", async () => {
    const { code } = await runCli([
      "-w",
      "default",
      "compare",
      "checkout_banner",
    ])
    expect(code).toBe(0)
  })
})

const changeRequest = (
  id: string,
  timestamp: number,
  defaultRule: { treatment: string; size: number }[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  status: "PUBLISHED",
  title: `Change ${id}`,
  requester: "ada@acme.test",
  operationType: "UPDATE",
  approvers: ["grace@acme.test"],
  comments: [{ user: "ada@acme.test", role: "SUBMITTER", timestamp }],
  split: {
    ...makeDefinition({ name: "checkout_banner", defaultRule }),
    environment: { id: PROD_ENV.id, name: PROD_ENV.name },
  },
  ...extra,
})

describe("history", () => {
  const api = () =>
    fixtureApi({
      changeRequests: [
        changeRequest("cr-1", 1_767_323_000_000, [
          { treatment: "off", size: 100 },
        ]),
        changeRequest(
          "cr-2",
          1_767_323_045_678,
          [{ treatment: "on", size: 100 }],
          {
            title: "Turn on for everyone",
          },
        ),
        changeRequest(
          "cr-3",
          1_767_323_050_000,
          [{ treatment: "on", size: 100 }],
          {
            status: "REJECTED",
          },
        ),
      ],
    })

  it("shows the default rule switch with its author and before/after", async () => {
    const { code, stdout } = await runCli(
      ["history", "checkout_banner", "--env", "Prod"],
      { api: api() },
    )
    expect(code).toBe(0)
    for (const column of [
      "TIME",
      "TITLE",
      "CHANGE TYPE",
      "APPROVERS",
      "EDITED BY",
      "STATUS",
    ])
      expect(stdout).toContain(column)
    expect(stdout).toContain("2026-01-02T03:04:05.678Z")
    expect(stdout).toContain("Turn on for everyone")
    expect(stdout).toContain("ada@acme.test")
    expect(stdout).toContain("default rule: off 100% -> on 100%")
    expect(stdout).not.toContain("cr-3")
  })

  it("returns changes as JSON with ISO times and diffs", async () => {
    const { stdout } = await runCli(
      ["history", "checkout_banner", "--env", "prod", "--json"],
      { api: api() },
    )
    const out = JSON.parse(stdout)
    expect(out.environment).toBe("Prod")
    expect(out.changes).toHaveLength(2)
    expect(out.changes[0]).toMatchObject({
      title: "Turn on for everyone",
      editedBy: "ada@acme.test",
      approvers: ["grace@acme.test"],
      timeIso: "2026-01-02T03:04:05.678Z",
      diff: [{ path: "defaultRule[0].treatment", before: "off", after: "on" }],
    })
    expect(out.changes[0]).not.toHaveProperty("definition")
  })

  it("asks for --env", async () => {
    const { code, stderr } = await runCli(["history", "checkout_banner"])
    expect(code).not.toBe(0)
    expect(stderr).toContain("--env")
  })

  it("explains an empty history", async () => {
    const { code, stdout, stderr } = await runCli([
      "history",
      "checkout_banner",
      "--env",
      "QA",
    ])
    expect(code).toBe(0)
    expect(stdout).toContain("No published change requests")
    expect(stderr).toContain("approval flow")
  })

  it("rejects a bad --limit", async () => {
    const { code } = await runCli([
      "history",
      "checkout_banner",
      "--env",
      "QA",
      "--limit",
      "0",
    ])
    expect(code).toBe(2)
  })
})
