# 2.20.19 — owned Action SDK and external integration boundaries

This candidate follows immutable 2.20.18. It is a private QA candidate, not full
feature or cross-platform acceptance.

## Action execution

`sema4ai/src/sema4ai_code/robo/action_runtime.py` requires the installed
`actions-core` distribution and checks that both `actions` and `actions.cli`
resolve to files recorded by that distribution before importing them. Missing,
broken or shadowed installations fail with instructions to add
`actions-core==1.0.3` to package.yaml and rebuild the selected environment. The
published version is the recommended baseline, not a claim that an unrelated
module with the same name is owned. The resolver never tries a vendor Action SDK.

Run/debug, list/version/metadata and lint share this boundary. Lint publishes an
Automation diagnostic; metadata retains the underlying error. Robot task
execution remains on its separate, explicitly configured `robot.yaml` task path
(including existing `robocorp.tasks` projects). The external-service legacy
setting does not opt Action packages into vendor SDK fallback.

## Default-off backend policy

The language-server command dispatcher uses the same `legacy-integrations.json`
manifest as the TypeScript command registrations. Gallery list/import RPCs check
the setting before progress, network or extraction, including their deferred
workers. Raw RCC cloud/credential/feedback calls also refuse execution before
executable lookup unless external compatibility was explicitly enabled. Local
run/debug, environment building and Work Items do not enable that setting.

The unused generic bootstrap descriptor with `robocorp-inspector` is removed.
Unsupported platforms now report an explicit error. Linux x64, Windows x64 and
macOS ARM descriptors remain; removing the unused descriptor is not evidence
that Windows or macOS ran.

## Local environment builder

From the repository root, with the prepared Python environment activated:

```sh
python sema4ai/bin/create_env/build_environment.py \
  --rcc /absolute/path/to/verified/rcc \
  --work-root /absolute/path/to/a-new-task-owned-build
```

`--check-only` verifies the hash, executable version and descriptor blueprint.
Without `--rcc`, the script obtains the exact GitHub release asset listed in
`sema4ai/published-tools.json`, then verifies its hash before execution. Existing
work directories are refused. New process-local HOME, ACTIONS_HOME, ROBOTS_HOME
and a private Holotree isolate the build. No data is moved, deleted or reused.

Real RCC 18.19.7 help says `holotree prebuild --export` requires shared Holotree.
The builder therefore supports local environment creation/validation and a JSON
receipt, but not a distributable Holotree archive. It never enables shared state,
HEADs a vendor CDN or publishes to remote storage. Private RCC stderr stays in
`rcc.private.log`; review before sharing it. The stale build task in the bootstrap
robot.yaml is removed; use the explicit local command above.

## Dependency findings and unresolved ownership

- Default Poetry projects no longer install `robocorp-log-pytest`. Existing local
  environments are preserved. Plain pytest remains the test runner.
- Published **actions-core 1.0.3 itself requires robocorp-log >=2.4,<4 and
  robocorp-truststore >=0.8.0**. Actual installed METADATA and the unchanged
  package lock confirm this. The extension cannot honestly remove these while
  retaining the published SDK contract. This needs an owned upstream publication
  or an explicit decision accepting these transitive libraries. No no-deps install,
  alias, altered wheel or unpublished substitution is used.
- Windows Java inspector still requires upstream
  `java-access-bridge-wrapper==1.2.0` / `JABWrapper`. No owned maintained package
  has been established. Full Java support is retained pending an approved owned
  source/package path; it is not relabeled or silently disabled. Linux proof
  cannot qualify Windows Java.
- The existing `.github/workflows/build_environments.yaml` still contains vendor
  download/publication configuration. **Do not run it.** Automatic approval review
  rejected a replacement as a workflow-execution change under the standing
  restriction. Permission to retire it with no hosted replacement is pending.
  No hosted job, storage configuration or credentials were changed. The new local
  builder requires an explicit fresh work root and will not execute the obsolete
  no-argument shared/publishing build flow. The retirement regression is explicitly
  skipped while approval is pending; this is a release hold, not a pass.

## Managed MCP schema compatibility

The client still requires its exact reviewed three tools, server identity,
protocol and model audience. Only a **string top-level inputSchema.description**
is excluded from comparison, accommodating the observed a38 prose difference.
Nested descriptions, payload properties named description, defaults, enum/const,
required fields, references and authority/validation constraints remain exact.
Unknown contracts fail closed. Auth, claims, confirmation, stable request IDs and
uncertain-result reconciliation are unchanged.

A native tester observed 2.20.18 reach a38 discovery and fail specifically at
canvas_inspect prose comparison. Regression tests use a simulated loopback MCP
server; they do not prove managed RCC execution. The replacement requires actual
installed native discovery/invocation retest on the authorized synthetic endpoint.

## Qualification and remaining desktop gates

Prepared toolchain: Node 24.21.0, Python 3.11.17, Poetry 2.1.3. Local source tests:
161 Node; 88 selected Python; one explicit workflow-approval skip. A cold Linux
builder run executed verified RCC version, blueprint and variables successfully
with a fresh private home. Exact artifact hashes, source SHA, installed payload
comparison and real CLI/DAP results are supplied in the candidate QA packet.

Required native retest: owned SDK missing/dependency diagnostic; Action/Robot
File/SQLite run/debug and attachments; metadata/lint; Gallery/default legacy
refusal; managed discovery with the actual a38 schema, explicit Run and retained
request outcomes. Preserve 2.20.18 as evidence of its own tests. Do not reuse its
screenshots as 2.20.19 acceptance. Windows/macOS and Java are unexecuted here;
archive export, the workflow hold and upstream dependency decisions remain open.
