// Child process for the restore-guard signal test. Loads heart-spinner first
// (it registers a SIGINT listener that calls process.exit before ours), installs
// the guard, and writes a marker file when restore runs.
const fs = require("fs")
require("../../src/shared/heart-spinner")
const { installRestoreGuard } = require("../../src/publishing/restore-guard")

const marker = process.argv[2]
let restored = false
installRestoreGuard(() => {
  if (restored) return
  restored = true
  fs.writeFileSync(marker, "restored")
})
process.stdout.write("ready\n")
setInterval(() => {}, 1000)
