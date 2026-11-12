# Runbook private checkpoint — 2.20.10

Implemented against exact PR1 head c81c72c08611b6d2c01149cb7cb2fa2b2674eac8, imported as a full clean git bundle (SHA256 372aedfd608ad39bc7bea8f816660e1093a6a91f62eca0b7ccef91ba524429f7). Source ownership transferred before edits; the prior writer is stopped. The containing commit identifies this checkpoint's source.

## Executed locally

- Lockfile install and TypeScript compile using Node 24.21.0.
- **104 / 104 Node tests passed**, including model, simulated VS Code host/DOM, transport and real-process Runtime identity tests. Full output: `node-tests.txt`.
- **32 / 32 focused Python tests passed** under Python 3.11.17 / Poetry 2.1.3: published tooling, Action/Robot Work Items discovery, launch computation. Full output: `python-tests.txt`.
- Git diff whitespace check passed. Generated manifest and command/view/settings constants regenerated from codegen.
- Frozen upstream Inspector engine SHA256 `213867dbae25e817f15a6bbe70da8dd2daf9770b9a76e960c21249f7f7024fdc`; Output engine `41cdf8b154eb30d43382462c44493358cd6e515dc7711149cb3d6c39b2945a1a`. Both are unchanged from the starting commit.
- Existing local Work Items behavior retained with nested forms, read-only outputs, attachment/replay lineage, revision-bound persisted drafts, selected receipt/result and actual queue claim guidance.
- Action input forms preserve V2/V3 metadata, unknown fields and OAuth descriptors. Run loader, signature refresh and OAuth execution remain the existing authority. Invalid/legacy/conflicting inputs stay unchanged and offer native advanced JSON.
- Runtime recovery verifies original Linux process birth/executable/package/listener ancestry. No environment/secrets read; no HTTP identity probe, process signal or unverified adoption. Existing old services without a record intentionally remain unverified.

## Evidence boundaries and next gates

**ALL FEATURES NOT COMPLETE. VISUAL QUALIFICATION NOT PASSED.**

This checkpoint is a private source/VSIX handoff for exact installed qualification, not a release. Simulated host/DOM results are not native editor, layout, accessibility or real Work Item execution acceptance.

The current cloud desktop CUA transport fails read-only screenshots. No alternate browser, desktop reset or security bypass was used. Isolated headless component rendering was proposed but remains pending explicit user approval. See root `design-qa.md` (`final result: blocked`) and `docs/runbook-view-checklist.md`.

Required next evidence: exact source/VSIX/installed payload identity; all views at matching viewport/state; theme/keyboard/error/empty states; all eight Action/Robot × File/SQLite × Run/Debug cells; draft refresh/close/reload, attachments, output replay/lineage and selected results; explicit new Runtime start → reload → verified reconnect. The old unrecorded 18083 listener must never be adopted to manufacture a recovery pass.

Canonical managed SQL/auth Work Items and platform-specific Windows/Java acceptance remain separately owned, incomplete integration gates. No GitHub Actions credits, production changes, credentials, merge, Marketplace or external publication are used by this checkpoint.
