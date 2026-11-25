# Architecture

The VS Code webview sends user actions to the extension host. The host validates actions and talks to the official Codex App Server over newline-delimited JSON-RPC on stdio. The native engine owns prompts, inference and tool orchestration, instructions, persistent conversations, skills, hooks, plugins, sandbox enforcement and approval policy.

## Runtime and protocol

Discover the exact Codex version on PATH, at known install locations, or in the supported official extension bundle layout. An explicit machine-scoped executable setting is available. Launch with the extension host's inherited environment, native `CODEX_HOME` and the selected workspace's canonical path. Native configuration applies from every layer, including managed and project settings. [Versioned methods](../protocol/0.155.1/methods.json)

The transport correlates requests and responses, bounds frames and pending requests, sanitizes its own errors, and closes failed child processes and relay connections. Unknown server requests fail closed. Scoped native events update only the selected thread and turn. Item snapshots supersede deltas, and terminal outcomes stop stale mutations. Reasoning content and raw response notifications are opted out where exposed by the protocol. Only native reasoning summaries are displayed.

## Thread lifecycle

Native thread IDs and provider/cwd metadata scope history. A read-only view uses paginated stored items. Resume attaches the client to an idle native thread. Before starting a turn, a bounded workspace-state checkpoint records thread ID, provider, method and the client message identifier. Reconciliation reads terminal turn state through App Server history. The extension never automatically submits the same turn again after ambiguous delivery.

## Webview and editor

The webview receives projected native data and offers a fixed set of extension actions. Untrusted labels render as text; Markdown disables raw HTML, navigation, and image loads. Approvals and secret or structured input are collected by native VS Code prompts. The UI separates cumulative tokens, latest increment, rate-limit windows, capacity, and API estimates. Native history stays in Codex, and attachment drafts and live transcripts are bounded in memory.

## API routing

Independent API mode creates a process-local custom Responses provider and a loopback relay. The original native config is read for routing and managed requirements before creating the override. The key is read from VS Code SecretStorage by the extension host. The App Server receives the relay capability only. [Independent API mode](independent-api-key.md)
