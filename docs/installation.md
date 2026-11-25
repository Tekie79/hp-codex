# Install HP Codex locally

## Requirements

Use desktop VS Code 1.95 or later, an installed official Codex CLI **0.155.1**, and a trusted workspace. macOS arm64 with VS Code 1.147.0 is the locally exercised combination. The installed official VS Code extension may ship a different runtime version. HP Codex reports the discovered version when it cannot negotiate this release's contract.

## Install a VSIX

In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**. Select the prerelease package from `dist/`, then reload the window. Open **HP Codex** from the Activity Bar. On a Mac with standard installation, the equivalent terminal command is:

```sh
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension dist/hp-codex-0.1.0.vsix
```

Use **Settings → Connection** to select a workspace if you have multiple roots. Check **Effective native settings** before working with a custom provider. An inherited model can be unavailable to the active account. Select an available native model in the composer for the next turn.

If runtime discovery fails, open VS Code machine settings and set `hpCodex.executable` to the trusted absolute path of Codex 0.155.1. The setting controls executable discovery. Native policy and configuration continue to apply.

If a turn's outcome is uncertain, use **Reconcile**. If native history cannot confirm the outcome, inspect that conversation in the official client before deciding what to do next.

## Build or remove

With Node 22 or later, run `npm ci`, `npm run check` and `npm run package:vsix`. The official `vsce` tool produces the prerelease artifact. Remove an independent HP key in Settings before uninstalling if you want to remove the saved secret from your profile. Uninstall **HP Codex** from the Extensions view.
