import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useWindowSize } from "ink"
import {
  colors,
  FooterHints,
  LoadingScreen,
  PAGE_CHROME,
  Page,
  StatusMessage,
  useAppKeys,
  type Hint,
} from "@kud/ink-ui"
import {
  ConfirmPanel,
  FlagDetail,
  FlagList,
  PlanTable,
  ResultList,
  type FlagDetailView,
} from "@kud/harness-fme-ink"
import type { ApplyResult, PlanItem } from "@kud/harness-fme"
import {
  applyFinished,
  commandFailed,
  confirmSummary,
  detailLoaded,
  handleKey,
  initialState,
  isTyping,
  loadInto,
  planLoaded,
  toPlanRows,
  type Cmd,
  type KeyInput,
  type LoadedData,
  type TuiConfig,
  type TuiState,
  type WriteRequest,
} from "./state.js"

// The app never fetches for itself: the host (or a test) injects everything.
export type TuiServices = {
  loadRows: () => Promise<LoadedData>
  loadDetail: (flag: string) => Promise<FlagDetailView>
  plan: (request: WriteRequest) => Promise<PlanItem[]>
  apply: (request: WriteRequest, plan: PlanItem[]) => Promise<ApplyResult[]>
  refresh: () => Promise<LoadedData>
}

export type TuiAppProps = {
  services: TuiServices
  config: TuiConfig
  // Observed by tests; the real host passes nothing and relies on Ink's exit.
  onExit?: () => void
}

const hintsFor = (screen: TuiState["screen"], readOnly: boolean): Hint[] => {
  if (screen === "list")
    return [
      ["↑↓", "move"],
      ["←→", "env"],
      ["space", "mark"],
      ["enter", "open"],
      ["o/f/a/x", readOnly ? "write (off)" : "write"],
      ["r", "refresh"],
    ]
  if (screen === "detail") return [["r", "refresh"]]
  if (screen === "results") return [["enter", "back"]]
  return []
}

// One claimant per key: useAppKeys owns q, esc and backspace and routes esc
// here through the peel; while a confirmation is being typed the hook stands
// down and this handler owns every key itself.
export const TuiApp = ({ services, config, onExit }: TuiAppProps) => {
  const { exit } = useApp()
  const [state, setState] = useState<TuiState>(() => initialState(config))
  const stateRef = useRef(state)
  const apply = (next: TuiState) => {
    stateRef.current = next
    setState(next)
  }
  const fail = (e: unknown) =>
    apply(
      commandFailed(
        stateRef.current,
        e instanceof Error ? e.message : String(e),
      ),
    )

  const load = async (fetch: () => Promise<LoadedData>) => {
    try {
      apply(loadInto(stateRef.current, await fetch()))
    } catch (e) {
      fail(e)
    }
  }

  const runCmd = async (cmd: Cmd) => {
    switch (cmd.type) {
      case "none":
        return
      case "quit":
        onExit?.()
        exit()
        return
      case "load":
        await load(services.loadRows)
        return
      case "refresh":
        await load(services.refresh)
        return
      case "detail":
        try {
          apply(
            detailLoaded(stateRef.current, await services.loadDetail(cmd.flag)),
          )
        } catch (e) {
          fail(e)
        }
        return
      case "plan":
        try {
          apply(planLoaded(stateRef.current, await services.plan(cmd.request)))
        } catch (e) {
          fail(e)
        }
        return
      case "apply": {
        try {
          const results = await services.apply(
            cmd.request,
            stateRef.current.plan ?? [],
          )
          apply(applyFinished(stateRef.current, results))
          // The list the user returns to must hold what the write did.
          await load(services.refresh)
        } catch (e) {
          fail(e)
        }
        return
      }
    }
  }

  const dispatch = (input: KeyInput) => {
    const { state: next, cmd } = handleKey(stateRef.current, input)
    apply(next)
    void runCmd(cmd)
  }

  useEffect(() => {
    void load(services.loadRows)
    // The first load runs once, on mount.
  }, [])

  const typing = isTyping(state)
  useAppKeys({
    onBack: () => dispatch("escape"),
    onQuit: () => {
      onExit?.()
      exit()
    },
    isActive: !typing,
  })

  useInput((input, key) => {
    // q belongs to useAppKeys; in the text mode of a production confirmation
    // the hook is stood down and q is a letter like any other.
    if (!typing && input === "q") return
    if (key.escape) {
      if (typing) dispatch("escape")
      return
    }
    if (key.backspace || key.delete) {
      if (typing) dispatch("backspace")
      return
    }
    if (key.upArrow) return dispatch("up")
    if (key.downArrow) return dispatch("down")
    if (key.leftArrow) return dispatch("left")
    if (key.rightArrow) return dispatch("right")
    if (key.return) return dispatch("enter")
    if (key.tab) return dispatch("tab")
    if (!input || key.ctrl || key.meta) return
    dispatch({ char: input })
  })

  const focused = state.columns[state.focus]?.name
  const size = useWindowSize()
  const listHeight = Math.max(3, (size.rows ?? 24) - PAGE_CHROME - 2)
  const planning = state.request?.environment

  return (
    <Page
      title="harness-fme"
      count={state.screen === "list" ? state.rows.length : undefined}
      noun="flag"
      scope={config.workspaceName}
      alert={state.readOnly ? "read-only" : undefined}
      status={state.busy ? { text: "working…", tone: "busy" } : undefined}
      counter={
        state.marked.length > 0 ? `${state.marked.length} marked` : undefined
      }
      hints={hintsFor(state.screen, state.readOnly)}
      page={state.screen === "list" ? "root" : "nested"}
      help={false}
      fill
    >
      <Box flexDirection="column">
        {state.screen === "list" ? (
          <FlagList
            rows={state.rows}
            selectedIndex={state.selected}
            height={listHeight}
            focusedEnvironment={focused}
            emptyText="no flags match"
          />
        ) : state.screen === "detail" ? (
          state.detail ? (
            <FlagDetail detail={state.detail} focusedEnvironment={focused} />
          ) : (
            <LoadingScreen label="reading definitions…" />
          )
        ) : state.screen === "plan" && planning ? (
          <>
            <PlanTable
              rows={toPlanRows(state.plan ?? [])}
              environment={planning.name}
              production={planning.production}
            />
            <Box marginTop={1} flexDirection="column">
              <ConfirmPanel
                environment={planning.name}
                production={planning.production}
                summary={confirmSummary(state)}
                typed={state.typed}
              />
            </Box>
          </>
        ) : state.screen === "results" ? (
          <>
            <ResultList rows={state.results} />
            <Text color={colors.muted}>enter back to the list</Text>
          </>
        ) : (
          <LoadingScreen label="loading…" />
        )}
        {state.message ? (
          <Box marginTop={1}>
            <StatusMessage variant="warning">{state.message}</StatusMessage>
          </Box>
        ) : null}
      </Box>
    </Page>
  )
}
