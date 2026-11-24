#!/usr/bin/env node
// React reads NODE_ENV when it is first loaded and ships its slower development
// build otherwise. Static imports are hoisted, so set it first and load the app
// dynamically. An explicit NODE_ENV (e.g. `NODE_ENV=development`) still wins.
process.env.NODE_ENV ??= "production"

const { run } = await import("./cli.js")

process.exitCode = await run(process.argv.slice(2))
