# Native Work Items synthetic fixtures

These packages use the owned `actions-work-items==0.4.4` public SDK. They are
synthetic local fixtures for the existing private extension candidate, not an
extension rebuild or managed Runtime acceptance. Copy the complete `action/`
and `robot/` directories to **new** task-owned workspace folders; do not replace
existing packages, queues, home directories or user files.

## Output attachment qualification

Both packages retain the original `consume` workload and add `copy_attachment`.
The Robot manifest exposes **Copy Work Item Attachment**. The Action is discovered
as `copy_attachment`.

1. In an isolated VS Code profile with the exact VSIX named in the accompanying qualification manifest, open the
   copied package and its native Work Items editor. Preserve the separate
   `ACTIONS_HOME` and `ROBOTS_HOME` settings and verified RCC18.19.7.
2. Choose **Local inputs**. Create an input using the form: field `value`, type
   number, value `7`. No JSON or schema authoring is needed.
3. Use **Add attachment** to attach the supplied `attachment-proof.txt` under that
   exact name. It contains exactly 47 UTF-8 bytes, with LF line endings and a
   final newline:

   ```text
   Automation Work Items attachment proof
   value=7
   ```

   SHA256: `f99ed98ea2dbf6908dc185741fb7aedcc6b0d938c4f08a2014defb9f5ac799c1`.
4. Run **copy_attachment** / **Copy Work Item Attachment**. Expect `observed: 7`
   and a read-only output attachment named **copied-proof.txt**. Download through
   the real editor to a new file and verify its byte count and SHA256 match above.
   Verify the original input attachment is still unchanged.
5. From that output choose **Replay as new input**, then save the new input.
   Confirm distinct identity, source/output lineage and the replay's copied
   attachment bytes. The replay is for inspection; it carries `observed` and
   `copied-proof.txt`, so it is not automatically valid input to copy_attachment.
6. Create a fresh input with `value: 7` and the original `attachment-proof.txt`.
   Set a breakpoint on the line marked **Desktop breakpoint** in the selected
   function. Debug, verify the correct package interpreter, continue, then repeat
   output/download/lineage checks. Do not use the earlier consume breakpoint.
7. Repeat Run and Debug in **Local queue** for both Action and Robot packages:
   eight real UI execution cells in total. Use a fresh queue per cell because a
   replay remains a new pending input and the published SDK reserves the oldest
   pending input. Verify SDK input COMPLETED and output `parent_id` equals that
   input. FileAdapter uses the local receipt's input/output-file binding; it does
   not provide a durable SQLite parent_id.
8. Negative checks: a fresh input with no attachment must fail with `No file with
   name: attachment-proof.txt`; a synthetic attachment with changed bytes must
   fail with `Expected the supplied synthetic attachment-proof.txt bytes`.
   Neither should create an output or a false successful completion.

The fixture reads attachments with `Input.get_file()`, saves outputs with
`outputs.create(payload=..., files=...)`, and completes the input with `done()`.
All item/queue/attachment writes go through the SDK. The download uses a private
temporary directory; the fixture checks exact synthetic bytes, handles at most
one item and uses no network, subprocess, timer or background worker itself.

## Stop/recovery without an artificial long-running service

No additional cancellable workload is needed: Debug copy_attachment with its
marked breakpoint, which occurs after SDK reservation and before output creation.
Once paused, the tester can explicitly stop that extension-owned debug session.
Capture actual receipt and SDK state; do not infer completion from the stop.
This controlled test does **not** qualify Stop during a non-debug Run.

For SQLite, preserve the SDK's configured orphan timeout (default 30 minutes).
Use the existing explicit recovery command only after the claim is eligible and
verify the actual SDK result. This fixture packet does not shorten timeouts, force
recovery, adopt unknown processes or prove managed cancellation. Resume/continue
normally if Stop/recovery is outside the current test cell.

## Bounded local CLI/DAP reproduction

Use the prepared toolchain and the existing installed extension path. Supply a
new output directory on every invocation; the harness refuses to overwrite one.

```sh
python sema4ai/tests/native_work_items_smoke.py \
  --rcc /absolute/path/to/verified/rcc-linux64 \
  --prepared-root /absolute/path/to/task-owned/prepared-homes \
  --extension-root /absolute/path/to/installed/automation-control-plane.automation-vscode-2.20.9 \
  --output /absolute/path/to/new-proof-directory \
  --workload copy_attachment
```

The prepared root supplies `os-home`, `actions-home` and `robots-home`. The harness
uses actual resolved package interpreters, checks SDK0.4.4, executes eight CLI/DAP
cells (four real breakpoints), downloads and compares output/replay attachments,
and runs eight missing/wrong-byte negative cases. Child calls are time-bounded.
Debugpy needs permitted local loopback sockets. The default `--workload consume`
retains the prior payload-only smoke. Neither is native editor/desktop acceptance;
the existing desktop tester must click the output download/replay controls.
