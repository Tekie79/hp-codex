# HP Codex

HP Codex is a VS Code frontend for the installed official Codex App Server. It uses the existing native account, configuration and workspace. The sidebar brings conversation, execution, history and native settings into one view.

## Try the local prerelease

The verified protocol version is **Codex 0.155.1**. Open HP Codex in a trusted local workspace. It connects automatically when there is one workspace folder. In a multi-root workspace, connect from the folder you want to use or choose a folder in Settings. The runtime discovers Codex on PATH, in common install locations, and in the official VS Code extension bundle when the bundled version matches. [Installation](docs/installation.md)

The sidebar shows native plans, tool activity, agent events, diffs and token snapshots as Codex sends them. History uses the native conversation store and is filtered by workspace and provider. Use Settings to inspect the effective native settings and installed integrations. The Plan mode protocol is experimental and requires a per-connection opt-in. [Capability matrix](docs/parity.md)

Independent API mode uses a separate OpenAI Platform key saved in VS Code SecretStorage. Each billable turn requires confirmation. Availability depends on the provider, API project, runtime and policy. The local preview still needs live paid and managed-policy qualification. [Independent API mode](docs/independent-api-key.md)

## Development

Use Node 22+ and a local VS Code installation. Run `npm ci`, `npm test` and `npm run check`. To launch the Extension Development Host, build with `npm run build` and press F5. Run `npm run test:ui` for the versioned fake-server suite in the actual local VS Code application. On Linux or a nonstandard install, set `HP_VSCODE_EXECUTABLE` to the VS Code executable. [Test evidence](docs/evidence.md)

HP Codex is an independent project. OpenAI's official clients remain available for account- and client-specific features.
