# Independent OpenAI API key mode

## User-facing contract

- Default: Use existing Codex, unchanged.
- Optional: Use HP Codex API key, stored separately in VS Code SecretStorage. User supplies a project key via a masked native prompt. Save, replace, remove and switch without modifying native auth/config, native key, shell environment, or user home.
- Use the same native Codex App Server, actual cwd, CODEX_HOME, effective native settings, sandbox, instructions, MCP servers, skills, plugins and hooks. No new agent engine or forced setup. Account-dependent cloud/connected features may differ; do not imply full API-mode parity.
- Show selected billing mode, account/provider state, usage and estimates. Require explicit consent for paid turns, no auto fallback, no automatic resubmission after ambiguous failure. Switching/key changes are blocked while a turn is active or uncertain; start fresh thread after an idle switch. Native history must remain intact and future history UI must scope sessions by mode/provider.

## Preview implementation

The extension host owns the key. A per-connection authenticated loopback relay uses a random bearer capability, not the OpenAI key. Native App Server is launched with a unique custom Responses provider defined via CLI -c overrides, fixed loopback URL and env_key for the temporary relay capability. It inherits the existing home/env; no native login/logout, config write, raw key in args or child env. The provider does not require OpenAI native auth for inference. The preview verifies effective provider config and thread modelProvider before paid turns. Native account metadata is not evidence of API key validity. Native account updates invalidate the connection state.

The relay binds only 127.0.0.1, accepts only authenticated POST /v1/responses or /v1/responses/compact during explicitly authorized turns, forwards only JSON to fixed HTTPS api.openai.com with the HP key, never follows redirects, streams successful responses, bounds request count/body/concurrency, rejects unknown paths, and hides upstream error bodies. This is a minimal local relay, not a complete hardened gateway or budget cap. Native process/tool code may be able to obtain the ephemeral capability depending on permissions; it is not the actual API key. Local same-user malicious processes and compromised extension hosts are outside the preview's threat model. Never use in untrusted workspaces. No real key or user prompt logged. Disable relay on completion, interruption, failure or uncertain outcome; close it when switching/disconnecting.

Before enabling release use, qualify supported native versions, provider schema, effective managed requirements, proxy/residency and network policy, account-dependent features, environment isolation, cancellation, API error mapping and real native SSE behavior; do not circumvent enterprise routing/requirements. Preview blocks API mode when managed provider constraints are detected or cannot be checked. A fully supported native process-local credential interface may replace the relay after evidence of equivalent isolation and shared account preservation. Never pass a real key to agent-visible environment variables merely to make compatibility tests pass.

References:
- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server (documented process-local custom Responses provider pattern; independent API key mode is separate from that OAuth flow).
