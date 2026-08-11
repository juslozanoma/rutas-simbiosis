# Testing Policy

## Mandatory

- Agents must NOT run tests of any kind to verify possible errors (no unit tests, no HTTP requests against the running server, no synthetic saves, no endpoint probes, nothing).
- Testing is done exclusively by the user.
- Agents focus on executing the requested tasks and deliver the changes ready for the user to verify.
- If in doubt about whether something works, do not run a probe: leave verification to the user.

# Code Investigation Rules

## Mandatory

- Do NOT search old versions of the code in git history unless the user explicitly asks you to compare something.
- Always solve the problem by looking at the current code as it is now.

# Browser Automation Rules

## Mandatory

When testing this project:

- Never close any existing Microsoft Edge or Google Chrome window.
- Never terminate or kill any browser process.
- Never call browser.close(), context.close(), page.close(), taskkill, Stop-Process, or any equivalent command on an existing browser session.
- Always reuse the currently open browser session whenever possible.
- If a new browser window or tab is required, leave it open after the task finishes.
- Existing browser windows are considered user-owned and must never be modified or closed.
- Only close a browser if I explicitly request it.