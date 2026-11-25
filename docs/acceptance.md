# Acceptance tests

Use versioned schemas, fake server fixtures and disposable workspace; live cases require explicit user consent and a compatible real Codex installation. Record commit, binary version, OS, account mode, exact steps, expected/actual and evidence. Never include credentials.

| ID | Scenario | Pass condition |
|---|---|---|
| A01 | Already logged into native Codex; open HP Codex | Same account/provider, no login prompt, no new home or credential copy |
| A02 | Custom CODEX_HOME, profile/env and layered project settings | Effective runtime config matches native CLI; no file modifications on connect/uninstall |
| A03 | Existing MCP with saved grants | Same effective inventory and working harmless tool; no reinstall or needless OAuth |
| A04 | Installed/disabled plugins, skills, hooks and apps | Correct inventory, enablement, trust and native invocation; disabled capability stays disabled |
| A05 | AGENTS.md nested rules, configured models/effort, permissions and policy | Native task honors all; no implicit overrides |
| A06 | Explicit ChatGPT browser/device sign in, API key and logout | Native flows, shared-account warning, masked secret, cancellation, correct status, paid consent, no fallback |
| A07 | Existing native history, resume/fork, account/workspace change | Correct scoped sessions; no duplicate transcripts or competing live turns |
| A08 | Real task, file reads/edits, searches, terminal and review | Native events and diffs, correct order/output, no fabricated events |
| A09 | Plan revisions and parallel agents | Accurate progress and agent states scoped to originating task |
| A10 | Usage duplicate/compaction/missing fields, rate reset | No double counting, unavailable unknowns, correct quota and occupancy definitions |
| A11 | Command/file/network/MCP approvals, tool questions and cancellation | Exact supported choices, never auto-approve, fail closed unknown, correct resolution |
| A12 | Interrupt, steer, server exit, ambiguous timeout | No duplicate turn or false completion; recover using native state |
| A13 | Malicious tool output, large logs and secrets | Safe text/CSP, bounded memory, no raw credentials or public logs |
| A14 | VS Code trust, local/remote/worktrees, incompatible version | Correct environment and policy; unsupported path clear |
| A15 | Light/dark, keyboard, narrow sidebar and accessibility | Usable, real processing visibility, no clipping of controls |
| A16 | Native official feature inventory | Each feature has versioned supported/unsupported evidence; no unsupported claims |
| A17 | Clean install, tests, VSIX, uninstall | Reproducible; original Codex settings/auth/history remain unchanged |

Compare behavior with official Codex using the same account, cwd and home. Do not modify existing user's real settings to make tests pass.
