import {
  addKeyOperation,
  evaluateWriteGate,
  isProductionEnvironment,
  removeKeyOperation,
  turnOffOperation,
  turnOnOperation,
  type ApplyResult,
  type Environment,
  type EnvironmentView,
  type FeatureFlag,
  type FlagOperation,
  type FlagRow,
  type PlanItem,
} from "@kud/harness-fme"
import type {
  EnvState,
  FlagDetailView,
  FlagRowView,
  PlanRowView,
  ResultRowView,
} from "@kud/harness-fme-ink"

export type WriteKind = "on" | "off" | "addKey" | "removeKey"

export type EnvColumn = { name: string; production: boolean }

export type WriteRequest = {
  kind: WriteKind
  operation: FlagOperation
  targets: string[]
  environment: EnvColumn
  // What stands for --env in the write gate: the typed text for a production
  // environment, the exact name otherwise.
  environmentArg: string
}

export type TuiScreen = "list" | "detail" | "plan" | "results"

export type TuiState = {
  screen: TuiScreen
  columns: EnvColumn[]
  rows: FlagRowView[]
  selected: number
  focus: number
  marked: string[]
  detail?: FlagDetailView
  request?: WriteRequest
  plan?: PlanItem[]
  results: ResultRowView[]
  typed: string
  message?: string
  busy: boolean
  readOnly: boolean
  keyId?: string
}

export type TuiConfig = {
  readOnly: boolean
  keyId?: string
  workspaceName: string
}

export type LoadedData = { rows: FlagRow[]; environments: Environment[] }

export const initialState = (config: TuiConfig): TuiState => ({
  screen: "list",
  columns: [],
  rows: [],
  selected: 0,
  focus: -1,
  marked: [],
  results: [],
  typed: "",
  busy: false,
  readOnly: config.readOnly,
  keyId: config.keyId,
})

export type Cmd =
  | { type: "none" }
  | { type: "quit" }
  | { type: "load" }
  | { type: "refresh" }
  | { type: "detail"; flag: string }
  | { type: "plan"; request: WriteRequest }
  | { type: "apply"; request: WriteRequest }

export type KeyInput =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "backspace"
  | "tab"
  | { char: string }

const NONE: Cmd = { type: "none" }

const charOf = (input: KeyInput): string | undefined =>
  typeof input === "string" ? undefined : input.char

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

// The first environment a write may safely land in. -1 leaves nothing focused:
// every environment is production and a write key must be refused.
export const firstNonProduction = (columns: EnvColumn[]): number =>
  columns.findIndex((column) => !column.production)

export const toEnvColumns = (environments: Environment[]): EnvColumn[] =>
  environments.map((environment) => ({
    name: environment.name,
    production: isProductionEnvironment(environment.name),
  }))

// Rollout "unknown" (a definition with no default rule) reads as not serving:
// the closest of the five states a list cell can name.
const toEnvState = (state: EnvironmentView["state"]): EnvState =>
  state === "unknown" ? "off" : state

export const toRowViews = (
  rows: FlagRow[],
  columns: EnvColumn[],
): FlagRowView[] =>
  rows.map((row) => ({
    flag: row.flag,
    rolloutStatus: row.rolloutStatus,
    environments: columns.map((column, i) => {
      const view = row.environments[i]
      return {
        environment: column.name,
        production: column.production,
        state: toEnvState(view?.state ?? "undefined"),
        defaultRule: view?.defaultRule ?? "-",
      }
    }),
  }))

export const toDetailView = (
  flag: FeatureFlag,
  views: EnvironmentView[],
): FlagDetailView => ({
  flag: flag.name,
  rolloutStatus: flag.rolloutStatus?.name,
  tags: (flag.tags ?? []).map((t) => t.name),
  description: flag.description,
  environments: views.map((view) => {
    const def = view.definition
    return {
      environment: view.environment,
      production: isProductionEnvironment(view.environment),
      state: toEnvState(view.state),
      defaultRule: view.defaultRule,
      traffic:
        def?.trafficAllocation === undefined
          ? "-"
          : `${def.trafficAllocation}%`,
      rules: def?.rules?.length ?? 0,
      keys: def
        ? def.treatments.reduce((n, t) => n + (t.keys?.length ?? 0), 0)
        : 0,
      segments: def
        ? [...new Set(def.treatments.flatMap((t) => t.segments ?? []))]
        : [],
    }
  }),
})

export const toPlanRows = (plan: PlanItem[]): PlanRowView[] =>
  plan.map((item) =>
    item.action === "update"
      ? { flag: item.flag, action: "update", detail: item.summary }
      : item.action === "skip"
        ? { flag: item.flag, action: "skip", detail: item.reason }
        : { flag: item.flag, action: "error", detail: item.reason },
  )

export const toResultViews = (results: ApplyResult[]): ResultRowView[] =>
  results.map((result) => ({
    flag: result.flag,
    status: result.status,
    reason: result.reason,
  }))

// Merge a fresh load into the state. The selection follows its flag if it is
// still there, the focus keeps its column when it still exists, and marks
// survive only for flags still in the list.
export const loadInto = (state: TuiState, data: LoadedData): TuiState => {
  const columns = toEnvColumns(data.environments)
  const rows = toRowViews(data.rows, columns)
  const names = rows.map((row) => row.flag)
  const selectedFlag = state.rows[state.selected]?.flag
  const selected = Math.max(0, names.indexOf(selectedFlag ?? ""))
  const focus =
    state.columns.length === 0
      ? firstNonProduction(columns)
      : state.focus >= 0 && state.focus < columns.length
        ? state.focus
        : firstNonProduction(columns)
  return {
    ...state,
    columns,
    rows,
    selected,
    focus,
    marked: state.marked.filter((flag) => names.includes(flag)),
    busy: false,
    message: undefined,
  }
}

export const moveSelection = (state: TuiState, delta: number): TuiState => ({
  ...state,
  selected: clamp(
    state.selected + delta,
    0,
    Math.max(0, state.rows.length - 1),
  ),
})

// A ring, like a tab bar: the columns are few and the eye expects wrap.
export const moveFocus = (state: TuiState, delta: number): TuiState => {
  if (state.columns.length === 0) return state
  const focus =
    (state.focus + delta + state.columns.length) % state.columns.length
  return { ...state, focus }
}

export const toggleMark = (state: TuiState): TuiState => {
  const flag = state.rows[state.selected]?.flag
  if (!flag) return state
  return {
    ...state,
    marked: state.marked.includes(flag)
      ? state.marked.filter((f) => f !== flag)
      : [...state.marked, flag],
  }
}

const WRITE_KEY_KINDS: Record<string, WriteKind> = {
  o: "on",
  f: "off",
  a: "addKey",
  x: "removeKey",
}

export const writeKindFor = (char: string): WriteKind | undefined =>
  WRITE_KEY_KINDS[char]

// a and x edit an individual key; on and off need nothing but --write.
const needsKeyId = (kind: WriteKind) =>
  kind === "addKey" || kind === "removeKey"

export const writeOperation = (
  kind: WriteKind,
  keyId: string,
): FlagOperation => {
  switch (kind) {
    case "on":
      return turnOnOperation()
    case "off":
      return turnOffOperation()
    case "addKey":
      return addKeyOperation({ key: keyId })
    case "removeKey":
      return removeKeyOperation({ key: keyId })
  }
}

// The flags a write acts on: the marked ones, or the selected flag.
export const writeTargets = (state: TuiState): string[] =>
  state.marked.length > 0
    ? state.marked
    : state.rows[state.selected]
      ? [state.rows[state.selected].flag]
      : []

// The plan screen for a production environment is a text mode: it owns every
// key until esc or a matching enter ends it.
export const isTyping = (state: TuiState): boolean =>
  state.screen === "plan" && (state.request?.environment.production ?? false)

export const confirmSummary = (state: TuiState): string => {
  const request = state.request
  if (!request) return ""
  return `${request.operation.describe} for ${request.targets.length} ${
    request.targets.length === 1 ? "flag" : "flags"
  } in ${request.environment.name}`
}

const backToList = (state: TuiState): TuiState => ({
  ...state,
  screen: "list",
  detail: undefined,
  plan: undefined,
  request: undefined,
  typed: "",
  message: undefined,
})

// The gate has the final word, exactly as for the CLI: the typed text is the
// environmentArg, and a refusal shows its reason without any request.
export const confirmApply = (
  state: TuiState,
): { state: TuiState; cmd: Cmd } => {
  const request = state.request
  if (!request) return { state, cmd: NONE }
  if (state.plan && !state.plan.some((item) => item.action === "update"))
    return { state: { ...state, message: "nothing to write" }, cmd: NONE }
  const environmentArg = request.environment.production
    ? state.typed
    : request.environment.name
  const gate = evaluateWriteGate({
    environmentName: request.environment.name,
    environmentArg,
    go: true,
  })
  if (gate.mode === "refused")
    return { state: { ...state, message: gate.reason }, cmd: NONE }
  return {
    state: { ...state, busy: true, message: undefined },
    cmd: { type: "apply", request: { ...request, environmentArg } },
  }
}

const startWrite = (
  state: TuiState,
  kind: WriteKind,
): { state: TuiState; cmd: Cmd } => {
  if (state.readOnly)
    return {
      state: { ...state, message: "read-only: start with --write" },
      cmd: NONE,
    }
  if (needsKeyId(kind) && !state.keyId)
    return {
      state: { ...state, message: "no key configured: set HARNESS_FME_KEY" },
      cmd: NONE,
    }
  const environment = state.columns[state.focus]
  if (!environment)
    return {
      state: {
        ...state,
        message: "pick an environment with left or right first",
      },
      cmd: NONE,
    }
  const targets = writeTargets(state)
  if (targets.length === 0)
    return { state: { ...state, message: "no flags to change" }, cmd: NONE }
  const request: WriteRequest = {
    kind,
    operation: writeOperation(kind, state.keyId ?? ""),
    targets,
    environment,
    environmentArg: environment.name,
  }
  return {
    state: { ...state, busy: true, message: undefined, request },
    cmd: { type: "plan", request },
  }
}

// One dispatcher for every key the app-level hooks do not own. useAppKeys owns
// q, esc and backspace and routes esc here through its peel; while a
// confirmation is being typed the hook stands down and this owns everything.
export const handleKey = (
  state: TuiState,
  input: KeyInput,
): { state: TuiState; cmd: Cmd } => {
  if (state.busy) return { state, cmd: NONE }

  if (input === "escape") {
    if (state.screen === "list") return { state, cmd: NONE }
    if (state.screen === "results")
      return { state: backToList(state), cmd: { type: "refresh" } }
    return { state: backToList(state), cmd: NONE }
  }

  if (isTyping(state)) {
    if (input === "backspace")
      return { state: { ...state, typed: state.typed.slice(0, -1) }, cmd: NONE }
    if (input === "enter") return confirmApply(state)
    const char = charOf(input)
    if (char)
      return { state: { ...state, typed: state.typed + char }, cmd: NONE }
    return { state, cmd: NONE }
  }

  if (input === "up") return { state: moveSelection(state, -1), cmd: NONE }
  if (input === "down") return { state: moveSelection(state, 1), cmd: NONE }
  if (input === "left") return { state: moveFocus(state, -1), cmd: NONE }
  if (input === "right") return { state: moveFocus(state, 1), cmd: NONE }
  if (input === "tab") return { state: moveFocus(state, 1), cmd: NONE }
  if (input === "enter") {
    if (state.screen === "list") {
      const flag = state.rows[state.selected]?.flag
      return flag
        ? {
            state: {
              ...state,
              screen: "detail",
              detail: undefined,
              busy: true,
            },
            cmd: { type: "detail", flag },
          }
        : { state, cmd: NONE }
    }
    if (state.screen === "results")
      return { state: backToList(state), cmd: { type: "refresh" } }
    return { state, cmd: NONE }
  }

  const char = charOf(input)
  if (!char) return { state, cmd: NONE }

  if (char === "r")
    return { state: { ...state, busy: true }, cmd: { type: "refresh" } }

  if (state.screen === "list") {
    if (char === " ") return { state: toggleMark(state), cmd: NONE }
    const kind = writeKindFor(char)
    if (kind) return startWrite(state, kind)
    return { state, cmd: NONE }
  }

  if (state.screen === "plan" && char === "y") return confirmApply(state)

  return { state, cmd: NONE }
}

export const planLoaded = (state: TuiState, plan: PlanItem[]): TuiState => ({
  ...state,
  screen: "plan",
  plan,
  typed: "",
  busy: false,
  message: undefined,
})

export const detailLoaded = (
  state: TuiState,
  detail: FlagDetailView,
): TuiState => ({ ...state, detail, busy: false })

export const applyFinished = (
  state: TuiState,
  results: ApplyResult[],
): TuiState => ({
  ...state,
  screen: "results",
  results: toResultViews(results),
  plan: undefined,
  busy: false,
})

// A failed command falls back to the list with the reason on screen; nothing
// partial stays behind it.
export const commandFailed = (state: TuiState, message: string): TuiState =>
  backToList({ ...state, busy: false, message })
