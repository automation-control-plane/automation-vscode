# Runtime 1.1.1 HTTP shutdown qualification

## Result

The isolated Linux reproduction resolved a synthetic Action Package with RCC 18.19.11, installed `actions-core` 1.1.0, ran its Action through Runtime 1.1.1 over HTTP, and shut Runtime down through the opt-in `RC_ADD_SHUTDOWN_API` endpoint. The Action returned `Hello HTTP Dakota`; shutdown returned HTTP 200; Runtime stopped without forced termination and exited with code 1.

That exit code is source-defined for this endpoint: the handler interrupts the server's main thread after sending the response, the CLI catches `KeyboardInterrupt` and returns 1, and the Go wrapper propagates the child status. The wrapper's `Error executing action-server: exit status 1` line is therefore consistent with the normal opt-in interrupt path. This is not an RCC/Runtime compatibility failure, and it is not a clean code-0 shutdown. No release documentation promising code 0 was found in the inspected source. The opt-in endpoint is not the normal Runtime stop path.

Runtime 1.1.1 extracted RCC 18.19.8. Its SHA-256 `ea8dc96e66d7a81536b03a344b4eaf44bbd94122585954e70290bd466f5de4b6` matches the current RCC Linux pin in `sema4ai/published-tools.json`. The production pins remain unchanged.

## Exact source trace

At Runtime source commit `9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2`:

1. [`_server.py`, lines 677–693](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/src/actions/server/_server.py#L677-L693) registers `/api/shutdown/` only when `RC_ADD_SHUTDOWN_API` is enabled and schedules `_thread.interrupt_main` after the response.
2. [`_cli_impl.py`, lines 1238–1249](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/src/actions/server/_cli_impl.py#L1238-L1249) catches that `KeyboardInterrupt`, logs `Exiting action server...`, returns 1, and kills child processes.
3. [`cli.py`, lines 22 and 62–65](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/src/actions/server/cli.py#L22-L65) exits with the CLI return code.
4. [`main.go`, lines 395–403](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/go-wrapper/main.go#L395-L403) logs and forwards a nonzero child exit status.

The release's [`test_shutdown_response_order.py`, lines 128–145](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/tests/action_server_tests/test_shutdown_response_order.py#L128-L145) verifies the response completes before the interrupt. It does not assert a code-0 exit.

## Reproduction

Run on Linux. The script uses only the exact candidate binaries from `candidate-tools.json`; it gives the process a fresh HOME, Actions home, Robots home, RCC cache, temporary directory and synthetic package beneath `--state`. It preserves inherited CA/proxy policy without copying user tokens, OAuth settings, execution profiles or live tool homes.

```sh
mkdir -p .cache/dogfood-qualification
work_root=$(mktemp -d .cache/dogfood-qualification/runtime-shutdown.XXXXXX)
curl --fail --location https://github.com/joshyorko/rcc/releases/download/v18.19.11/rcc-linux64 -o "$work_root/rcc-linux64"
curl --fail --location https://github.com/joshyorko/actions/releases/download/actions-runtime-1.1.1/actions-runtime-1.1.1-linux64 -o "$work_root/actions-runtime-1.1.1-linux64"
chmod 700 "$work_root/rcc-linux64" "$work_root/actions-runtime-1.1.1-linux64"
PYTHONPATH=sema4ai/src:sema4ai-python-ls-core/src:sema4ai/tests \
  /tmp/automation-vscode-dogfood-venv/bin/python sema4ai/tests/runtime_shutdown_smoke.py \
  --rcc "$work_root/rcc-linux64" \
  --runtime "$work_root/actions-runtime-1.1.1-linux64" \
  --candidate-tools docs/evidence/dogfood-setup-20261115/candidate-tools.json \
  --state "$work_root/state"
```

The sanitized receipt is `state/qualification.json`; the raw local Runtime log remains in the ignored state directory for diagnosis. The focused evidence-classifier tests run with:

```sh
/tmp/automation-vscode-dogfood-venv/bin/python -m pytest --noconftest sema4ai/tests/test_runtime_shutdown_driver.py -q
```
