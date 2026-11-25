# Security review

This review covers HP Codex 0.1.0 local prerelease, Codex 0.155.1, and the VS Code extension-host, webview, App Server and independent API relay boundaries.

| Area | Control | Evidence and residual risk |
|---|---|---|
| Native configuration and trust | Discover an exact runtime; inherit environment and working directory. VS Code trust and native policy apply at their respective boundaries. Shared writes require native dialogs. | Fake environment and process tests. Real config/account read comparison in a disposable repo. Managed deployments remain unqualified. |
| Shared native auth | Read account state by default. Supported native login/logout and OAuth actions require explicit confirmation. | No native token handling by HP Codex. Live sign-in, sign-out, and app OAuth need a controlled account. |
| Independent credentials | VS Code SecretStorage; masked entry; refuse keys already present in inherited environment. Random relay capability is distinct from the key. Route and requirements verified twice before the paid request path. | Synthetic provider and relay tests. Native effective custom provider probe with disarmed relay. Same-user processes can access the capability depending on OS and process permissions. Keyed paid end-to-end and managed-policy routing are release gates. |
| Egress and billing | Loopback-only authenticated relay; fixed direct HTTPS host; bounded paths, concurrency, body, time and request count; upstream redirects are rejected. Native provider retries disabled. | Synthetic tests for invalid token, idle, request limits and unsupported paths. The request cap is a transport limit. A capability holder can still submit allowed billable requests while a confirmed turn is armed. |
| Uncertain execution | Native ID and connection scoping, durable client receipt ID, singleton start checkpoint, no automatic resend or fallback. | Fake App Server exercises timeout, malformed data, server exit, interrupt, and lost acknowledgement. A missing terminal history record can require manual reconciliation. |
| Server requests | Known kinds only, explicit native VS Code decisions, scope checks, cancellation on stale requests. | Fake transport and UI tests. Prompt payloads are bounded. Client-specific verification and unsupported forms are rejected. |
| Webview | Deny-by-default CSP, nonce, scoped static assets, no outgoing links or inline HTML. Markdown renders escaped token output. Narrow actions, bounded state and no protocol bridge. | Hostile Markdown and CSP regression tests. Native output is displayed to the current user as data. Raw protocol and stderr are discarded. |
| Distribution | Locked dependencies, official VSCE, package allowlist, checksum, local install. | Exact artifact checks in the evidence log. Desktop, remote and enterprise interoperability remain release gates. |

Production status remains open until the outstanding items in [acceptance](acceptance.md) are qualified.
