# Automation Control Plane

Create, run and debug Action Packages and Robot Tasks in Visual Studio Code using published [RCC](https://github.com/joshyorko/rcc) and [Actions](https://github.com/joshyorko/actions) tooling.

This private compatibility fork is under qualification. The [feature acceptance ledger](https://github.com/automation-control-plane/automation-vscode/blob/port/published-rcc-actions-20261022/docs/compatibility-port.md) records actual executions, pending checks and backend limitations. Installing a candidate does not imply that every feature or platform has passed acceptance.

## Install the private candidate

1. Obtain the private VSIX and its SHA256 from the repository owner.
2. In VS Code, run **Extensions: Install from VSIX…**, select the file, then reload when prompted. The extension ID is `automation-control-plane.automation-vscode`.
3. Open your project and select the **Automation** activity bar. Run **Automation: Create Action Package** or **Automation: Create Task Package** from the command palette.
4. Use the package tree to select, run and debug actions and tasks. Configure action inputs before running an action.

## Features and configuration

- Action, Task and Agent package creation and discovery; local run/debug and environment terminals.
- Python language server integration, Work Items, and web/desktop inspectors. Windows and Java inspectors require their platform prerequisites.
- Published tooling: RCC **18.19.7**, Actions Runtime **1.0.4**, Core **1.0.3** and Work Items **0.4.4**. Explicit executable settings take precedence over downloads. Managed downloads verify release digests and executable identity.
- Separate `ACTIONS_HOME` (default `~/.actions`) and `ROBOTS_HOME` (default `~/.robots`); Action Server state is under `ACTIONS_HOME/action-server`. Existing operator overrides are preserved. Existing data is never migrated automatically.
- Configure `sema4ai.actionServer.port` (default `8082`) to an unused loopback port. Runtime launch refuses occupied ports and never adopts or stops unrelated listeners.
- The **Automation: RCC Python** status item shows the resolved package interpreter path in its tooltip. Microsoft Python discovery may classify RCC environments as unknown; that classification is separate from the package interpreter used for run/debug.
- Action and Robot Work Items use their owning package’s `devdata` folders; ordinary runs preserve previous outputs.
- Stable `sema4ai.*` setting, command and debugger IDs remain for configuration compatibility.

**Compatibility limits:** published Runtime 1.0.4 bundles RCC 18.19.3 and its artifact adapter rejects the requested RCC 18.19.7. This remains an open compatibility gate; version checks are not bypassed. Control Room, Sema4.ai Studio, Data Server, authentication, Agent CLI and publishing integrations remain available as explicitly labeled legacy integrations, subject to their backend and operator prerequisites. No vendor executable is downloaded as a fallback.

The candidate targets Linux x64, Windows x64 and macOS Apple Silicon. Linux workload checks have executed; platform and GUI acceptance status is recorded in the ledger. VS Code 1.101 or newer is required. Activation may acquire verified tooling and Python environment dependencies; configure executable paths and network access as appropriate for your installation.

## Development and issues

See [development guidance](https://github.com/automation-control-plane/automation-vscode/blob/port/published-rcc-actions-20261022/docs/develop.md) and [compatibility findings](https://github.com/automation-control-plane/automation-vscode/blob/port/published-rcc-actions-20261022/docs/compatibility-port.md). Report problems in the [private repository](https://github.com/automation-control-plane/automation-vscode/issues). The issue command opens a draft in your browser for review; diagnostic logs stay local until you choose to share them.

## Attribution

This fork derives from the Sema4.ai / Robocorp VS Code extension. Original copyright, Apache-2.0 license and third party notices are retained in the package. Legacy backend names identify compatibility targets; they do not identify this extension's publisher.
