# Product requirements

## Release objective

HP Codex is a complete alternative VS Code presentation layer for native Codex capabilities, with the activity density of Kilo Code. The same installed engine, native account and effective configuration are the source of truth. On a compatible machine that already runs Codex, the user installs HP Codex, opens the sidebar and starts working without reconfiguring anything.

## P0 requirements

| ID | Capability | Required behavior |
|---|---|---|
| R01 | Native runtime | Auto-discover compatible official executable (PATH, supported official extension bundle or documented install location); inspect version/schema; never download/replace silently. Start app-server using the existing environment and workspace. |
| R02 | Shared config | Honor native CODEX_HOME/default, config.toml layering, project trust, managed requirements, profile, model/provider/effort, rules, hooks, environment, network, sandbox and approvals. No parallel configuration. |
| R03 | Authentication modes | Default to existing native Codex account/settings. Support native ChatGPT browser/device and native account actions explicitly. Separately support HP-owned OpenAI API key in SecretStorage with process-local inference routing and no native auth changes, visible mode, explicit paid-turn consent, fresh thread on switch, key replacement/removal and no automatic fallback. |
| R04 | Existing MCP | Enumerate effective configured servers, tools, auth, status and resources; use engine's native discovery and execution. Reuse authenticated connections/grants where available; only prompt when native runtime requires it. Reload native config on request. |
| R05 | Plugins/skills/apps/hooks | Discover existing installed/enabled plugins, connected apps, skills and hooks via native APIs; preserve enablement, policy, trust and account scopes. Support invocation, picker/mentions, lifecycle and native management where supported. Render safe MCP app resources and user input when available. |
| R06 | Projects/instructions | Inherit AGENTS.md, nested instructions, workspace rules and project settings; multi-root/worktree support, actual editor context, file selection and attachments. |
| R07 | Sessions | List/read/resume/fork/rename/archive supported native sessions. Avoid duplicate history store. Never attach competing clients to live execution without supported ownership. Account/workspace scope preserved. |
| R08 | Composer | New tasks, follow-up, steer, stop, plan mode, review, model/effort selection, file/image references, native slash commands and skill/plugin actions as supported. |
| R09 | Live processing | Ordered expandable agent/tool/file/search/command/diff/terminal rows, native reported durations and results, task title, elapsed time, errors, pause/interrupt state. No fabricated file reads or reasoning. |
| R10 | Plans | Current checklist, completed/total, progress and revisions based on authoritative native events. |
| R11 | Agents | Native subagent creation/coordination, agent tree/status, child event history and native controls where exposed. |
| R12 | Metrics | Token graph, input/cache/output/reasoning breakdown, context capacity and verified occupancy, subscription windows/reset, API estimate only with dated model-specific rates and valid billing data. |
| R13 | Approvals | Exact command/file/network/MCP/permission requests, choices offered by runtime, user input, scope, expiration, denial and resolution. No bypass. |
| R14 | Editing/review | Native file changes, diff viewer, jump to file, review flows, terminal and supported undo/revert; distinguish editor-only helpers from engine capabilities. |
| R15 | Recovery | Robust lifecycle, reconnect and reconcile, history and safe cancellation; do not retry ambiguous billed tasks. |
| R16 | UI | Dense Kilo-inspired layout, theme, keyboard navigation, expandable rows, filter/search, autoscroll, visible error and loading states; no copied proprietary assets. |
| R17 | Settings parity | Show effective sanitized settings, source/provenance and manage native settings only by explicit supported action. No independent provider or plugin configuration. |
| R18 | Delivery | Reproducible tests/build, VSIX, macOS Apple Silicon first, support matrix and visual/end-to-end validation. |
| R19 | Cloud/remote | Inventory every official Codex cloud, remote, worktree, editor and managed-account feature; implement through supported native/public surfaces where available. Document access limits and handoff for unsupported UI-only/private functionality. No promise of backend parity without evidence. |

## Out of scope / hard constraints

No alternate LLM engine, private ChatGPT endpoints, raw auth token import, hidden reasoning extraction, duplicate MCP/plugin setup, forced account switches, permission bypass, silent billing, copied client identity, mandatory cloud server or fabricated monitoring. Full parity is a tracked target; managed services and surface-specific features may not be exposed to third-party clients.

R20 (P0): Independent HP Codex API key mode as specified in docs/independent-api-key.md. Native local configuration and integrations remain inherited, but provider-specific features and ChatGPT-only entitlements must be evaluated and labeled separately. Changing/removing this key cannot change native login or native API credentials.

## Prerelease qualification

The first candidate targets Codex 0.155.1 and Apple Silicon macOS. It treats generated stable methods as the default and explicitly opts in to native Plan mode. Official-client handoffs and per-feature qualification are recorded in [the capability matrix](parity.md) and [evidence](evidence.md). Any remaining mandatory release gate keeps the build in prerelease.
