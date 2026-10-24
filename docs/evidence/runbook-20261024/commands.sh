#!/usr/bin/env bash
# Recorded producer commands, not a consumer setup script. Each smoke output
# directory must be new. Paths here intentionally identify the executed evidence.
set -eu
source /workspace/.setup/activate.sh
cd /workspace/automation-vscode/sema4ai
candidate_root=/tmp/automation-native-qa-20261024/installed-2.20.11/extensions/automation-control-plane.automation-vscode-2.20.11
proof_root=/tmp/automation-release-20261024
prepared_root=/workspace/port-acceptance/restart-2.20.5/automation-published-smoke-kcqpn1k2
verified_rcc=/workspace/port-acceptance/qualified-871151ce/downloads/rcc-linux64
verified_runtime=/workspace/port-acceptance/qualified-871151ce/downloads/actions-runtime-1.0.4-linux64

npm test
poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py -q
poetry run pytest tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out "$proof_root/automation-vscode-2.20.11-linux-x64.vsix"
# Official Code CLI install command is retained in cli-install.json.
poetry run python tests/native_work_items_smoke.py --rcc "$verified_rcc" --prepared-root "$prepared_root" --extension-root "$candidate_root" --output "$proof_root/work-items-attachments" --workload copy_attachment
poetry run python tests/rcc_terminal_dap_smoke.py --rcc "$verified_rcc" --prepared-root "$prepared_root" --extension-root "$candidate_root" --output "$proof_root/robot-terminal"
poetry run python tests/published_lsp_smoke.py --extension-root "$candidate_root" --environment-json "$prepared_root/action-environment.json" --workspace "$prepared_root/workspace" --rcc "$verified_rcc" --runtime "$verified_runtime" --output "$proof_root/lsp"
poetry run python tests/native_runtime_api_smoke.py --runtime "$verified_runtime" --prepared-root "$prepared_root" --extension-root "$candidate_root" --output "$proof_root/runtime-storage"
node tests/runtime_restart_smoke.js "$candidate_root" "$verified_runtime" "$prepared_root/workspace/action-package" "$prepared_root" "$proof_root"
