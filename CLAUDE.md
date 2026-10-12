# CLAUDE.md

This repo is part of the HODL MVP. The full specification is `docs/BUILD_PLAN.md`.

- Read section 1 of `docs/BUILD_PLAN.md` before any work, and follow it.
- Do only the step the founder names. At the end of the step, run its "Done when" test and show the result.
- If the test passes, commit with the message "step X.Y: <step name>" and push. Then stop.
- If the test fails, fix it inside the same step. After 3 failed tries, stop and show the error.
- Write the least code that passes the "Done when" test.
- Never ask for, read, print or commit a private key, API key or password. Never open `.env` or `~/.hodl/`; use variable names only. The founder fills `.env`.
- Do not run a command that needs the keystore password. Give the founder the exact command to run in the terminal pane.
- Do not use sudo or install global tools. Give the founder the exact command instead.
