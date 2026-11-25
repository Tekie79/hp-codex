# HP Codex

Independent VS Code frontend for the existing native OpenAI Codex installation. Kilo Code-inspired execution visibility without replacing the Codex agent.

**Core principle: zero duplicate setup.** Inherit the same Codex home, effective settings, account, MCP servers, enabled plugins, skills, hooks, agents and project instructions. Do not create an HP-specific Codex home or duplicate credentials. Use the native App Server, not a separate inference API or orchestration engine.

## Development status

Initial foundation and experimental local monitor. Full native-feature parity is the release goal, not a completed claim. See [requirements](docs/requirements.md), [architecture](docs/architecture.md), [milestones](docs/milestones.md), [acceptance](docs/acceptance.md) and [implementation handoff](docs/codex-implementation-prompt.md).

## Try the foundation

Open the repository in VS Code 1.95+ with Node 20+ and the official Codex CLI on PATH. Run npm test and npm run check. Press F5 to open the extension development host, then open a trusted local folder and the HP Codex sidebar. Click Connect. Existing native authentication is inherited; the preview does not sign out or create an account. Type a small harmless task only if the displayed account/provider is what you intend to use. API mode may incur costs. The preview does not submit API-key turns without a native confirmation.

The preview demonstrates native stdio, connection, existing account status, a new thread, live item/plan/usage events, stop, and a compact sidebar. It denies interactive server requests rather than auto-approving them. Auth switching, history/resume, complete approvals, plugin/skill/MCP inspection UI, device flow, native extension-bundled binary discovery, remote tasks and full visual qualification are pending. No real account or live Codex run has been tested for this seed.

If the binary is not on PATH, a trusted machine setting hpCodex.executable can point to its absolute path. The release must discover a compatible existing installed/bundled engine without extra user configuration when possible.

Upstream: https://github.com/openai/codex ; https://developers.openai.com/codex/app-server ; https://developers.openai.com/codex/

This independent project is not affiliated with OpenAI or Kilo Code.
