# Released Runtime canonical managed assessment

This is separate qualification work based on ready PR #14 at `5068bb85`.
Production pins and that PR's branch remain unchanged.

[`qualification.json`](qualification.json) records the clean committed-driver
execution at `e7fe79c4cd5ac1a2bac15765cc9dfddf3fbf55e1`, including exact driver,
Runtime and authorization-schema hashes. Its full-lifecycle result is explicitly
false; the successful availability checks do not override the blocked grant.

The exact Linux Runtime 1.1.1 binary (SHA-256
`8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0`,
source `9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2`) was started on loopback
with an explicit synthetic API key, fresh owned homes and a private SQLite
database. `--actions-sync=false` avoids importing any user's Action Package.

Observed checks:

- Unauthenticated canonical schema access returns 401.
- Authenticated schema access returns 200 and exactly matches the extension's
  `managed-v1.json` contract.
- The freshly bootstrapped identity has no Work Items grants: capabilities
  return 403 `forbidden`. Startup does not manufacture permissions.
- The actual binary's `authorize-local --schema` advertises seven queue grants,
  but not `work_items.retry`.

## Full lifecycle remains unavailable through the supported setup route

The managed domain defines retry, but the public local authorization request
cannot grant it. See [`QueuePermission`](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/src/actions/server/_local_authorization.py#L54-L82)
and [`Permission.RETRY`](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/src/actions/server/managed_work_items/contracts.py#L30-L49).
The execution bootstrap also requires an externally provisioned strict Runtime
execution profile, a verified prepared-RCC receipt and immutable authorized
deployment references. The inspected release has no general CLI that creates
that complete configuration. Its developer preparation tool and direct-Robot
acceptance fixture expressly have narrower test scopes; substituting them would
not prove the ordinary released CLI lifecycle.

Full enqueue/claim/complete/retry/review qualification is therefore **not passed**.
No SQL grants, fake receipts, caller-supplied worker identities, fixture server,
or authentication fallback were inserted to manufacture a pass. Resolving that
gap requires a supported profile/provisioning path and retry authorization in
the Runtime, not additional access to Josh's existing data.

The release's native private-provider bootstrap is Linux-only. Windows candidate
qualification covers conventional installed Action/Robot workloads separately;
it cannot be relabeled as canonical managed lifecycle acceptance.

## Reproduce the assessment

Use an existing test interpreter and the verified binary. The state path must
not already exist and must be on disk-backed task storage:

```sh
/tmp/automation-vscode-dogfood-venv/bin/python sema4ai/tests/qualify_canonical_runtime.py \
  --runtime /path/to/verified/actions-runtime-1.1.1-linux64 \
  --state "$PWD/.cache/dogfood-qualification/canonical-fresh"
```

The script records the source head, dirty state, driver and artifact hashes,
SQL/auth results, public authorization surface, and shutdown outcome. Logs and
generated credentials stay inside the private test root; only sanitized
assessment JSON belongs in this evidence directory.
