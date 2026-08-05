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