# Lessons

## Lesson: Separate ChatGPT Auth From API Mode

### Anti-Pattern
Treating "Codex" as one transport and presenting API-key/gateway routes without checking the user's actual launch path and authentication mode.

### Pattern
Verify the live client, launcher, and auth mode before claiming proxy coverage. Distinguish Codex App with ChatGPT login from Codex OpenAI-compatible/API mode, and show only routes relevant to the user's setup.

### Trigger
Any imgtokenx install, compatibility, dashboard, or live-traffic claim involving Codex or another multi-auth client.

## Lesson: Persistence Labels Require Durable Writes

### Anti-Pattern
Labeling an in-memory dashboard toggle with "persist with an environment variable" and treating that as persisted behavior.

### Pattern
A control presented as persistent must write durable configuration itself and have a restart-style test proving the next process reads the saved value.

### Trigger
Any dashboard control, setting, or status copy that claims or implies persistence across process restarts.
