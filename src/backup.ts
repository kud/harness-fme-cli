import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type BackupInfo } from "@kud/harness-fme"

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_")

export const stamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-")

// One directory per run, one JSON file per flag:
//   <root>/<run stamp>/<environment>/<flag>.json
// Each file holds the definition exactly as read just before the write, so it
// can be put back by hand if a change turns out to be wrong.
export const makeBackupWriter = ({
  root,
  runStamp,
  environmentName,
  workspaceId,
  now,
}: {
  root: string
  runStamp: string
  environmentName: string
  workspaceId: string
  now: () => Date
}) => {
  const dir = join(root, runStamp, safeSegment(environmentName))
  return {
    dir: join(root, runStamp),
    write: ({ flag, definition }: BackupInfo) => {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${safeSegment(flag)}.json`)
      writeFileSync(
        file,
        JSON.stringify(
          {
            workspaceId,
            environment: environmentName,
            flag,
            savedAt: now().toISOString(),
            definition,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      )
    },
  }
}
