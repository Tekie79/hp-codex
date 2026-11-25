# Qualification evidence

## Candidate and environment

| Item | Observed value |
|---|---|
| Test date | 2026-11-25, America/New_York |
| Packaged runtime code revision | `699d815e398cc695523dc367cf0423c583f9345c` |
| Runtime | Official Codex CLI 0.155.1, stable and opt-in experimental protocol generated locally |
| VS Code | 1.147.0 arm64, build `8a14f0cc1b08d531eb83255ea3764ae22aa932b5` |
| Official VS Code extension present | `openai.chatgpt@26.1120.50957`; bundled Codex `0.171.0-alpha.13.2` is outside the HP Codex version gate |
| Host | macOS 26.3.2 (25D2150), arm64, Node 24.19.0, npm 11.17.0 |
| Artifact | `dist/hp-codex-0.1.0.vsix`, prerelease, official VSCE 4.1.1 |
| SHA-256 | `68d1e496d771a54889e86caaa2d3847d0f9bb99e27c24065225829aa343720e8` |

## Automated evidence

- `npm ci` succeeded. `npm test` passed 22 tests. Tests cover inherited environment, runtime version rejection, native request and event correlation, history, approvals, steering, interruption, timeout and malformed data, lost acknowledgement, relay routing and credential isolation, pricing and webview escaping.
- `npm run check` passed ESLint, TypeScript checks against the generated protocol, and the optimized webview build. `npm audit --audit-level=moderate` reported zero vulnerabilities.
- The four VS Code UI scenarios use a versioned synthetic server in the installed VS Code application. It covers light/dark themes, narrow and wide layouts, paged transcripts, keyboard send, approval decisions, a large command response, agent tree, checklist, token graph, hostile Markdown, interrupt/steer, an uncertain turn restored after a window reload, and masked key save, replacement, removal and mode switching. The light-theme and independent-key runs use the installed VSIX when `HP_VSCODE_VSIX` is set.
- Screenshots are local in `dist/evidence/`. Synthetic fixtures and the live disposable workspace both use invented task contents. The package and PR exclude raw transcripts, home paths and credentials.

## Live native and VS Code results

| Scenario | Result |
|---|---|
| Existing ChatGPT login and native configuration | PASS. App Server and development host connected without a login prompt. Account and selected settings were shown in the sidebar. |
| Native integration discovery | PASS for inventory. The disposable workspace returned 10 MCP servers, 26 skills, 34 plugins, 23 connected apps and zero hooks. Tool invocation and shared account/integration mutations remain separate qualification items. |
| Default model error | PASS for error reporting. The inherited `gpt-6.2-sol` default was rejected by the current ChatGPT account. Explicitly selecting the catalog's GPT-6-Sol for a turn worked and preserved the stored default. |
| File change approval and edit | PASS on the installed prerelease at implementation revision `bde810d`. An earlier window closed while waiting for approval; native history confirmed its terminal interrupted state and the file was absent. On the next installed run the user authorized the exact `hp-smoke.txt` addition. The VS Code native prompt submitted one approval, the exact one-line file was verified, and the turn completed. No additional permission was granted. |
| Native terminal and history | PASS. A separate real read-only App Server turn ran the line-count command with exit code 0 and appeared in native history. The installed VSIX listed the earlier native conversations. |
| Native usage | PASS for live thread snapshots in both development and installed views. The successful edit turn ended at 76,856 cumulative tokens. Occupancy remains unavailable from the supported telemetry. |
| Plan mode and agents | PASS for the live App Server fixtures. Plan mode produced a native plan item. A separate read-only turn spawned a subagent, completed, and its stored native items replayed to one agent with completed status. Synthetic VS Code evidence covers checklist revisions and multiple child agents. |
| Independent API | PASS for the installed CLI custom-provider route and returned thread provider with a disarmed relay. The VS Code fixture exercised masked save/replace/remove and native switch-back using a synthetic key. The real paid-route gate requires a key and explicit billing consent. |
| Shared native integrity | Opaque before/after SHA-256 comparisons found the present native `config.toml` and `auth.json` files unchanged after the native smoke runs. Only equality was recorded. |
| Installation lifecycle | PASS. Installed seed 0.0.2 in a disposable VS Code profile, upgraded to 0.1.0, uninstalled, and reinstalled. Installed the final checked package in the Mac's normal VS Code extension directory and verified the installed files. The official extension remained installed and the standalone App Server still recognized the native account. |

The final archive passed `unzip -t`, its SHA-256 was verified, and all 20 entries matched the expected package inventory. The package excludes development directories and scanned credential signatures. [Security review](security-review.md)

## Production release gates

Real paid execution and managed-policy tests remain unqualified. Live browser/device sign-in, sign-out, OAuth use, full MCP elicitation, cross-client concurrency, remote/container hosts and official-client features are beyond the verified local cases. The extension remains a local prerelease. [Acceptance](acceptance.md), [Capability matrix](parity.md)
