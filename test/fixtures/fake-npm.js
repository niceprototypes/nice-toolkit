#!/usr/bin/env node
// Stand-in for `npm publish` in publish tests. Behaviour is chosen by
// FAKE_NPM_MODE: success | eotp | hang | authurl | authurl-then-ok.
const mode = process.env.FAKE_NPM_MODE || "success"
const keepAlive = () => setInterval(() => {}, 1000)

switch (mode) {
  case "success":
    process.stderr.write("npm notice Publishing to https://registry.npmjs.org/ with tag latest\n")
    process.stdout.write("+ fake-pkg@1.0.0\n")
    process.exit(0)
  case "eotp":
    process.stderr.write("npm error code EOTP\nnpm error This operation requires a one-time password from your authenticator.\n")
    process.exit(1)
  case "hang":
    keepAlive()
    break
  case "authurl":
    process.stderr.write("Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/fake-token\n")
    keepAlive()
    break
  case "authurl-then-ok":
    process.stderr.write("Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/fake-token\n")
    setTimeout(() => process.exit(0), 200)
    break
  default:
    process.stderr.write(`unknown FAKE_NPM_MODE ${mode}\n`)
    process.exit(2)
}
