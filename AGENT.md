# Agent Collaboration Rules

## Commit Discipline

- Use fine-grained commits. Each commit should contain one coherent logical change.
- Split schema/type changes, service behavior, API/tool surface, UI changes, tests, and docs into separate commits when they can be reviewed independently.
- Do not group a broad implementation into one or two large commits just because the feature was requested as one task.
- Before committing, review `git diff --stat` and `git diff --name-only`; if the changed files span multiple concerns, split the commit.
- Keep unrelated generated or user-created files out of the commit unless they are explicitly part of the task.
