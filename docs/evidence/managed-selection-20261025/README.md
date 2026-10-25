# Managed execution selection preparation

This checkpoint corrects the issue/PR lookup and prepares a pure typed DTO
boundary for the public a38 MCP recipe. It does not wire a transport, register UI,
claim an item, invoke a capability or produce a replacement VSIX. The exact 2.20.17
artifact remains at source `bf30612d5326ffeef29d3da26241c6d7c67d3ae3` for the
existing desktop tester.

Verified source, endpoint/tool names, audience checks, invocation fields, current
head versus installed source and remaining integration coordination are recorded
in `../../managed-execution-dependency.md`.

From `sema4ai`, after `/workspace/.setup/activate.sh`:

```sh
npm test
node --test tests/managed_execution_selection.test.js
```

Final TypeScript compile and full Node suite: **154 passed**, zero failures/skips.
New selection boundary: **5 passed**, covering readonly application/descriptor
projection, snapshot omission preservation and frozen identity, cross-scope and
revision denial, stale/foreign claim refusal, protocol size bounds and metadata
separation. The initial five failures were the missing new module, not a claim
that the preceding artifact regressed. No Python implementation changed; Python
and native UI were not rerun for this preparation-only checkpoint.

The module consumes structuredContent, never app-session/private View metadata.
It retains independent input-mode/standalone projections without granting an
operation. The invocation builder uses the actual matching selected claim and
adds no actor/audience/worker override or guessed idempotency key.

Upstream disposition: none. Read-only source inspection; no backend changes,
secrets, hosted CI, publication, merge, new branch or replacement artifact.
