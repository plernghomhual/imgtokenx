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

## Lesson: Verify Remote Ownership Before Rename

### Anti-Pattern
Treating `origin` as the user's writable fork and issuing a repository rename without first validating the authenticated GitHub identity and repository ownership.

### Pattern
Before any remote rename, verify `gh auth status`, the authenticated login, `git remote -v`, repository ownership/fork metadata, and the installed `gh` command's flag constraints. When creating a fork from the current clone, omit the repository argument so `gh` can keep the source as `upstream` and install the user's fork as `origin`. Fetch the newly created `origin/main` and verify ancestry before the first push; the fork may snapshot a newer upstream head than the local remote-tracking ref.

### Trigger
Any GitHub repository rename, transfer, fork creation, or remote reassignment.

## Lesson: Triage Fork Ancestry Before Integration

### Anti-Pattern
Merging every newer upstream commit merely to avoid replacing a newly created fork branch, even when those commits include unrelated models, large evaluation artifacts, or behavior outside the user's requested scope.

### Pattern
Classify remote-only commits before integration. With explicit approval, preserve the verified local product branch using an exact `--force-with-lease`, then port only the requested runtime fixes, documentation, profiles, and tests. Keep model-specific evidence and unsupported providers out unless the user actually needs them.

### Trigger
A newly created fork snapshots a newer upstream `main` while the local product branch has intentionally diverged.
