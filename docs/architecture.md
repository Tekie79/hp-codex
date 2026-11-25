# Architecture

VS Code webview -> extension host/client adapter -> native Codex App Server (stdio) -> existing Codex runtime.

## Shared environment contract (non-negotiable)

Launch the existing supported binary with the actual selected workspace cwd and inherited process environment. If CODEX_HOME is set, preserve it verbatim; otherwise allow Codex to resolve its own default (commonly ~/.codex). Do not synthesize a new config, import credentials, parse auth.json, change environment providers or override policy. Use native config/read and configRequirements/read where available to inspect effective settings safely. Preserve original settings even on uninstall. Existing official clients may use a separate live process; shared persistent settings/history do not imply shared live process ownership. Respect native concurrency and resume limitations.

Read native account status and account identity/routing where supported. Only on user instruction invoke native account login or logout; warn these can change the shared account. API mode requires explicit paid-action consent; never change provider automatically. Device/browser auth follows runtime-supported URLs and state, not homemade OAuth.

Discover MCP, installed plugins, apps, skills, hooks and models using version-matched native methods (e.g., mcpServerStatus/list, skills/list, plugin/list, app/list, hooks/list, model/list, config/read). Respect effective enablement and permission scopes. Distinguish unavailable vs empty. No raw config secrets in the UI. Use native config reload/management APIs only on explicit user request. The runtime is responsible for starting MCP servers, injecting skills, applying instructions and executing tools.

## App Server adapter

Verify released binary protocol via official docs and generated schemas. Newline-delimited JSON-RPC, initialize/initialized, request correlation, notifications, server requests, cancellation and timeout. No raw protocol forwarding to webview. Versioned capability adapters; no unsupported experimental API calls without explicit tested opt-in.

Native thread/start, thread/list/read/resume/fork and turn/start/steer/interrupt provide session behavior. Omit model, provider, sandbox, instructions and config overrides by default. Scope all events by thread/turn/item and connection generation. Preserve effective thread settings. Reconcile ambiguous requests using native state instead of resubmitting. Native approvals must be supported exactly; unknown server requests fail closed.

Process item/started and item/completed, supported deltas, plan updates, token usage, diffs and agent collaboration. Render only safe summaries. Keep cumulative tokens and latest increments distinct. Context capacity is not occupancy. Estimate API price only with valid rate data. Subscription quota is not a dollar figure.

## UI and storage

Header: connection/account/model, task/status and elapsed. Usage graph and actual counters. Plan checklist. Expandable activity, agent tree and native diffs. Composer and editor integration. Native settings/inventory panel and history. Theme tokens, accessible controls and narrow sidebar.

Codex owns settings, secrets, history and plugin state; HP Codex stores only its UI preferences and bounded transient views by default. No telemetry in HP Codex. Existing engine behavior remains subject to native settings. All untrusted content renders as text or isolated, permission-checked native resources. No arbitrary shell or RPC bridge.

## Parity boundaries

App Server exposes native harness functionality; official UI-only features, private reasoning, cloud backend and client-specific authentication/verification may differ. Maintain evidence-backed capability matrix per released version. Unsupported functions must be visibly unavailable with supported official-client handoff where possible. Do not emulate proprietary endpoints or impersonate client identity.

References: https://developers.openai.com/codex/app-server ; https://github.com/openai/codex/tree/main/codex-rs/app-server ; https://developers.openai.com/resources/docs-mcp
