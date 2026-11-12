import { type EnvironmentView, type PlanItem } from "@kud/harness-fme"

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g")

export type Style = {
  bold: (s: string) => string
  dim: (s: string) => string
  red: (s: string) => string
  green: (s: string) => string
  yellow: (s: string) => string
}

const wrap = (code: string) => (s: string) => `${ESC}[${code}m${s}${ESC}[0m`

export const makeStyle = (color: boolean): Style =>
  color
    ? {
        bold: wrap("1"),
        dim: wrap("2"),
        red: wrap("31"),
        green: wrap("32"),
        yellow: wrap("33"),
      }
    : {
        bold: (s) => s,
        dim: (s) => s,
        red: (s) => s,
        green: (s) => s,
        yellow: (s) => s,
      }

const visibleLength = (s: string) => s.replace(ANSI, "").length

export const renderTable = (
  headers: string[],
  rows: string[][],
  style: Style,
): string => {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ""))),
  )
  const line = (cells: string[], paint: (s: string) => string = (s) => s) =>
    cells
      .map((c, i) =>
        i === cells.length - 1
          ? paint(c)
          : paint(c) + " ".repeat(widths[i] - visibleLength(c)),
      )
      .join("  ")
      .trimEnd()
  return [line(headers, style.bold), ...rows.map((r) => line(r))].join("\n")
}

// What a flag does for everyone in one environment. The words carry the
// meaning; colour only backs them up.
export const stateCell = (view: EnvironmentView, style: Style): string => {
  switch (view.state) {
    case "undefined":
      return style.dim("-")
    case "killed":
      return style.red("killed")
    case "on":
      return style.green(view.defaultRule)
    case "partial":
      return style.yellow(view.defaultRule)
    default:
      return view.defaultRule
  }
}

export const actionCell = (item: PlanItem, style: Style): string =>
  item.action === "update"
    ? style.green("update")
    : item.action === "error"
      ? style.red("error")
      : style.dim("skip")

export const planDetail = (item: PlanItem): string =>
  item.action === "update" ? item.summary : item.reason

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`
