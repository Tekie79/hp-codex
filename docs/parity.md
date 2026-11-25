# Native capability matrix

HP Codex 0.1.0 prerelease uses the generated App Server contract from the installed official Codex CLI 0.155.1. Official client columns summarize documented product surfaces. Qualification of HP Codex features is tracked separately. [App Server](https://learn.chatgpt.com/docs/app-server), [CLI](https://developers.openai.com/codex/cli), [official IDE](https://learn.chatgpt.com/docs/codex/ide), [desktop features](https://learn.chatgpt.com/docs/features)

| Capability | App Server 0.155.1 | CLI | Official IDE | Desktop | HP Codex 0.1.0 |
|---|---|---|---|---|---|
| Native settings, account and project instructions | Inherited at launch | Yes | Yes | Yes | Inherited environment and canonical workspace directory. Sanitized settings with source types. |
| Native auth and quota | Account/login, status and rate limits | Yes | Yes | Yes | Existing account auto-connect, explicit browser/device sign-in and sign-out, reported quota windows. Shared sign-in mutations remain unqualified. |
| Workspace and thread history | Start, list, read, resume, fork, archive, unarchive, name, item paging | Yes | History | History, projects | Workspace/provider filtering, read or resume, fork, name, archive/restore. Activity ownership across independent live clients has limited evidence. |
| Models, reasoning, Plan mode | Native model list, turn options, experimental collaboration modes | Yes | Yes | Yes | Explicit selection from native catalog. Plan mode requires per-connection opt-in. |
| Composer and editor context | Text, images, skill and app references, fuzzy file search | Yes | Yes | Yes | User-selected local images, file mentions, selection context, skills and callable apps. Plugin picker offers its enabled skills. |
| Code review and slash commands | Review and selected thread APIs | Native command registry | Surface-specific | Surface-specific | Inline review, selected equivalent slash actions, app-specific controls. CLI registry is not exported as a stable App Server API. |
| Native agents and parallel execution | Collaboration and subagent item events | Native multi-agent | Native multi-agent | Native multi-agent and desktop orchestration | Native agents run under the inherited harness. Sidebar shows correlated status, names when available, and results. Parallel top-level task management is an official-client handoff. |
| Turn controls and recovery | Start, steer, interrupt, history | Yes | Yes | Yes | Turn correlation and checkpoints. Replay of an ambiguous turn is disabled. |
| Tools, approvals and interaction | Command, patch, network, additional permissions, input, MCP elicitation | Yes | Yes | Yes | Native VS Code prompts and explicit choices. Standard supported primitive MCP forms and URL prompts. Unrecognized schemas, desktop verification and dynamic client tools fail closed. |
| MCP and plugins | Native inventories, OAuth and config reload; plugin lifecycle APIs | Yes | Integrations | Integrations and embedded apps | Inventory, native MCP OAuth/reload, enabled skill selection and management. Plugin install/share and embedded app UI use official clients. |
| Observability | Token snapshots, plans, patches and typed activities | Terminal | IDE stream | Activity UI | Native counters, latest graph, plans, activity filter, diff document, hook events, observed agent timing. Exact context occupancy unavailable. |
| File revert and worktrees | Conversation revert; CLI-managed worktrees | Yes | Source Control | Managed workflows | Native conversation history revert. VS Code Source Control handles file diffs and reversions. Worktree creation opens the official CLI. |
| Remote workspace | Workspace extension host and local stdio on that host | Yes | Platform-dependent | Remote environments | Native-mode remote host path is implemented. Remote-host integration remains unqualified. Independent API mode is local. |
| Cloud tasks, Remote Control, scheduled work | Surface-specific services and experimental APIs | Selected CLI support | Entitlement-dependent | Yes | Official-client handoff from Settings. No HP scheduling or remote pairing. |
| Independent OpenAI API key | Custom Responses provider | Native provider/auth configuration | Native provider/auth settings | Account/provider dependent | HP key in VS Code SecretStorage, separate relay, per-turn consent. Paid end-to-end and managed-policy testing remain open. |

Versioned method inventory includes both the stable and experimental capability lists emitted by the CLI. [Generated method inventory](../protocol/0.155.1/methods.json)
