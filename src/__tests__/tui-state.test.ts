import { describe, expect, it } from "vitest"
import type { FlagRow } from "@kud/harness-fme"
import {
  confirmApply,
  firstNonProduction,
  handleKey,
  initialState,
  isTyping,
  loadInto,
  moveFocus,
  moveSelection,
  toEnvColumns,
  toggleMark,
  writeOperation,
  writeTargets,
  type TuiState,
} from "../tui/state.js"

const row = (flag: string): FlagRow => ({
  flag,
  environments: [{ environment: "QA", state: "off", defaultRule: "off 100%" }],
})

const ready = (over: Partial<TuiState> = {}): TuiState => ({
  ...initialState({
    readOnly: false,
    keyId: "0a1b2c3d-0000-4000-8000-000000000001",
    workspaceName: "Default",
  }),
  columns: toEnvColumns([
    { id: "qa", name: "QA" },
    { id: "prod", name: "Prod" },
  ]),
  rows: [
    {
      flag: "checkout_new_flow",
      rolloutStatus: "Ramping",
      environments: [
        {
          environment: "QA",
          production: false,
          state: "off",
          defaultRule: "off 100%",
        },
        {
          environment: "Prod",
          production: true,
          state: "partial",
          defaultRule: "on 30% / off 70%",
        },
      ],
    },
    {
      flag: "search_rewrite",
      environments: [
        {
          environment: "QA",
          production: false,
          state: "on",
          defaultRule: "on 100%",
        },
        {
          environment: "Prod",
          production: true,
          state: "undefined",
          defaultRule: "-",
        },
      ],
    },
  ],
  selected: 0,
  focus: 0,
  ...over,
})

const char = (c: string) => ({ char: c })

const planned = (over: Partial<TuiState> = {}): TuiState =>
  ready({
    screen: "plan",
    busy: false,
    typed: "",
    request: {
      kind: "on",
      operation: writeOperation("on", "key"),
      targets: ["checkout_new_flow"],
      environment: { name: "QA", production: false },
      environmentArg: "QA",
    },
    ...over,
  })

const prodPlanned = planned({
  request: {
    kind: "on",
    operation: writeOperation("on", "key"),
    targets: ["checkout_new_flow"],
    environment: { name: "Prod", production: true },
    environmentArg: "",
  },
})

describe("initial focus", () => {
  it("lands on the first non-production environment", () => {
    const state = loadInto(
      initialState({ readOnly: true, workspaceName: "Default" }),
      {
        rows: [row("checkout_new_flow")],
        environments: [
          { id: "qa", name: "QA" },
          { id: "prod", name: "Prod" },
        ],
      },
    )
    expect(state.columns.map((c) => c.name)).toEqual(["QA", "Prod"])
    expect(state.columns.map((c) => c.production)).toEqual([false, true])
    expect(state.focus).toBe(0)
  })

  it("skips production when it comes first", () => {
    const state = loadInto(
      initialState({ readOnly: true, workspaceName: "Default" }),
      {
        rows: [],
        environments: [
          { id: "prod", name: "Prod" },
          { id: "staging", name: "Staging" },
          { id: "qa", name: "QA" },
        ],
      },
    )
    expect(state.focus).toBe(1)
    expect(state.columns[state.focus]).toMatchObject({ name: "Staging" })
  })

  it("leaves nothing focused when every environment is production", () => {
    const state = loadInto(
      initialState({ readOnly: true, workspaceName: "Default" }),
      { rows: [], environments: [{ id: "prod", name: "Prod" }] },
    )
    expect(state.focus).toBe(-1)
    expect(firstNonProduction(state.columns)).toBe(-1)
  })
})

describe("list keys", () => {
  it("move the selection and clamp at the ends", () => {
    const down = moveSelection(ready(), 1)
    expect(down.selected).toBe(1)
    expect(moveSelection(down, 1).selected).toBe(1)
    expect(moveSelection(ready(), -1).selected).toBe(0)
  })

  it("move the focus in a ring", () => {
    const state = ready()
    expect(moveFocus(state, 1).focus).toBe(1)
    expect(moveFocus(moveFocus(state, 1), 1).focus).toBe(0)
    expect(moveFocus(state, -1).focus).toBe(1)
  })

  it("mark and unmark the selected flag", () => {
    expect(toggleMark(ready()).marked).toEqual(["checkout_new_flow"])
    expect(toggleMark(toggleMark(ready())).marked).toEqual([])
  })
})

describe("write keys", () => {
  it("act on the marked flags when there are any", () => {
    const marked = toggleMark({ ...ready(), selected: 1 })
    expect(writeTargets(marked)).toEqual(["search_rewrite"])
    const both = toggleMark({ ...toggleMark(ready()), selected: 1 })
    expect(writeTargets(both)).toEqual(["checkout_new_flow", "search_rewrite"])
  })

  it("fall back to the selected flag", () => {
    expect(writeTargets(ready({ selected: 1 }))).toEqual(["search_rewrite"])
  })

  it("are refused in read-only mode with the message and no request", () => {
    const state = ready({ readOnly: true })
    for (const key of ["o", "f", "a", "x"]) {
      const { state: next, cmd } = handleKey(state, char(key))
      expect(cmd).toEqual({ type: "none" })
      expect(next.message).toBe("read-only: start with --write")
    }
  })

  it("need HARNESS_FME_KEY for the key operations", () => {
    const { state: next, cmd } = handleKey(
      ready({ keyId: undefined }),
      char("a"),
    )
    expect(cmd).toEqual({ type: "none" })
    expect(next.message).toContain("HARNESS_FME_KEY")
    const on = handleKey(ready({ keyId: undefined }), char("o"))
    expect(on.cmd.type).toBe("plan")
  })

  it("are refused while no environment is focused", () => {
    const { state: next, cmd } = handleKey(ready({ focus: -1 }), char("o"))
    expect(cmd).toEqual({ type: "none" })
    expect(next.message).toContain("left or right")
  })

  it("plan the focused environment and keep the request", () => {
    const { state: next, cmd } = handleKey(ready(), char("o"))
    expect(cmd).toEqual({
      type: "plan",
      request: {
        kind: "on",
        operation: expect.objectContaining({
          describe: "serve on to everyone by default",
        }),
        targets: ["checkout_new_flow"],
        environment: { name: "QA", production: false },
        environmentArg: "QA",
      },
    })
    expect(next.busy).toBe(true)
  })

  it("plan every marked flag at once", () => {
    const both = toggleMark({ ...toggleMark(ready()), selected: 1 })
    const { cmd } = handleKey(both, char("o"))
    if (cmd.type !== "plan") throw new Error("expected a plan command")
    expect(cmd.request.targets).toEqual(["checkout_new_flow", "search_rewrite"])
  })
})

describe("the plan screen and its confirmation", () => {
  it("applies a non-production write on y", () => {
    const { state: next, cmd } = handleKey(planned(), char("y"))
    expect(cmd.type).toBe("apply")
    if (cmd.type === "apply") expect(cmd.request.environmentArg).toBe("QA")
    expect(next.busy).toBe(true)
  })

  it("does not apply a plan with nothing to write", () => {
    const empty = {
      ...planned(),
      plan: [
        {
          flag: "checkout_banner",
          action: "skip" as const,
          reason: "already on",
        },
      ],
    }
    const { state: next, cmd } = handleKey(empty, char("y"))
    expect(cmd).toEqual({ type: "none" })
    expect(next.message).toBe("nothing to write")
  })

  it("treats esc on the plan screen as a cancel back to the list", () => {
    const { state: next, cmd } = handleKey(planned(), "escape")
    expect(next.screen).toBe("list")
    expect(next.request).toBeUndefined()
    expect(cmd).toEqual({ type: "none" })
  })

  it("does not apply on y for a production environment: typing owns the screen", () => {
    expect(isTyping(prodPlanned)).toBe(true)
    const { state: typed, cmd } = handleKey(prodPlanned, char("y"))
    expect(cmd).toEqual({ type: "none" })
    expect(typed.typed).toBe("y")
  })

  it("never applies a wrong or case-different name", () => {
    for (const typed of ["prod", "PROD", "Prodd", ""]) {
      const { state: next, cmd } = confirmApply({ ...prodPlanned, typed })
      expect(cmd).toEqual({ type: "none" })
      expect(next.busy).toBe(false)
      expect(next.message).toContain("looks like production")
    }
  })

  it("applies when the exact name is typed", () => {
    const { state: next, cmd } = confirmApply({ ...prodPlanned, typed: "Prod" })
    expect(cmd.type).toBe("apply")
    if (cmd.type === "apply") expect(cmd.request.environmentArg).toBe("Prod")
    expect(next.busy).toBe(true)
  })

  it("lets q type a letter while the confirmation is open", () => {
    const { state: next, cmd } = handleKey(prodPlanned, char("q"))
    expect(cmd).toEqual({ type: "none" })
    expect(next.typed).toBe("q")
    const { state: erased } = handleKey(next, "backspace")
    expect(erased.typed).toBe("")
    const { state: cancelled } = handleKey(erased, "escape")
    expect(cancelled.screen).toBe("list")
  })

  it("cancels a production confirmation with esc before anything is typed", () => {
    const { state: next, cmd } = handleKey(prodPlanned, "escape")
    expect(cmd).toEqual({ type: "none" })
    expect(next.screen).toBe("list")
  })
})

describe("results and refresh", () => {
  it("returns from the results screen to a refreshed list", () => {
    const state = ready({
      screen: "results",
      results: [{ flag: "checkout_new_flow", status: "applied" }],
    })
    const { state: next, cmd } = handleKey(state, "enter")
    expect(next.screen).toBe("list")
    expect(cmd).toEqual({ type: "refresh" })
  })

  it("refreshes with r from the list", () => {
    const { cmd, state } = handleKey(ready(), char("r"))
    expect(cmd).toEqual({ type: "refresh" })
    expect(state.busy).toBe(true)
  })

  it("keeps the selection with its flag across a reload", () => {
    const next = loadInto(ready({ selected: 1 }), {
      rows: [row("checkout_new_flow"), row("search_rewrite")],
      environments: [
        { id: "qa", name: "QA" },
        { id: "prod", name: "Prod" },
      ],
    })
    expect(next.selected).toBe(1)
    expect(next.focus).toBe(0)
  })
})

describe("busy", () => {
  it("ignores keys while a command is in flight", () => {
    const state = ready({ busy: true })
    const { state: next, cmd } = handleKey(state, char("o"))
    expect(cmd).toEqual({ type: "none" })
    expect(next).toEqual(state)
  })
})
