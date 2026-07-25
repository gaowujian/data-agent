# Issue tracker: GitHub

Issues and PRDs for this repo live in `gaowujian/data-agent` GitHub Issues. Use the `gh` CLI with `--repo gaowujian/data-agent` for all operations.

## Conventions

- **Create an issue**: `gh issue create --repo gaowujian/data-agent --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --repo gaowujian/data-agent --comments`.
- **List issues**: `gh issue list --repo gaowujian/data-agent --state open --json number,title,body,labels,comments`.
- **Comment on an issue**: `gh issue comment <number> --repo gaowujian/data-agent --body "..."`.
- **Apply / remove labels**: use `gh issue edit <number> --repo gaowujian/data-agent`.
- **Close**: `gh issue close <number> --repo gaowujian/data-agent --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `gaowujian/data-agent`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo gaowujian/data-agent --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a GitHub sub-issue linked to the map. Where sub-issues aren't enabled, use a task list and add `Part of #<map>` to the child.
- **Blocking**: use GitHub native issue dependencies. Where unavailable, add `Blocked by: #<n>` to the child body.
- **Frontier query**: select the first open, unblocked and unassigned child in map order.
- **Claim**: `gh issue edit <n> --repo gaowujian/data-agent --add-assignee @me`.
- **Resolve**: comment with the answer, close the child, then add its context pointer to the map.
