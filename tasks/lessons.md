# Lessons

## Lesson: Separate ChatGPT Auth From API Mode

### Anti-Pattern
Treating "Codex" as one transport and presenting API-key/gateway routes without checking the user's actual launch path and authentication mode.

### Pattern
Verify the live client, launcher, and auth mode before claiming proxy coverage. Distinguish Codex App with ChatGPT login from Codex OpenAI-compatible/API mode, and show only routes relevant to the user's setup.

### Trigger
Any pxpipe install, compatibility, dashboard, or live-traffic claim involving Codex or another multi-auth client.
