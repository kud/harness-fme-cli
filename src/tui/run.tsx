import React from "react"
import { render } from "ink"
import { TuiApp, type TuiServices } from "./app.js"
import type { TuiConfig } from "./state.js"

// Full-screen mount: the alternate screen keeps the shell history clean and is
// restored when the app exits.
export const mountTui = async ({
  services,
  config,
}: {
  services: TuiServices
  config: TuiConfig
}): Promise<void> => {
  const instance = render(<TuiApp services={services} config={config} />, {
    alternateScreen: true,
    exitOnCtrlC: true,
  })
  await instance.waitUntilExit()
}
