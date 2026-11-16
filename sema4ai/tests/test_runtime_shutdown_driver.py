"""Tests for the Runtime 1.1.1 shutdown evidence classifier."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "runtime_shutdown_smoke", Path(__file__).with_name("runtime_shutdown_smoke.py")
)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class RuntimeShutdownEvidence(unittest.TestCase):
    def test_source_defined_keyboard_interrupt_exit_is_recorded(self):
        log = "\n".join(
            (
                "POST /api/shutdown/ 200 OK",
                "Stopping action server...",
                "Exiting action server...",
                "Error executing action-server: exit status 1",
            )
        )
        result = driver.validate_shutdown(200, 1, False, log)
        self.assertIn("source-defined status 1", result)

    def test_http_failure_and_forced_stop_are_not_accepted(self):
        log = "Stopping action server...\nExiting action server...\nError executing action-server: exit status 1"
        with self.assertRaisesRegex(RuntimeError, "HTTP 200"):
            driver.validate_shutdown(500, 1, False, log)
        with self.assertRaisesRegex(RuntimeError, "forced termination"):
            driver.validate_shutdown(200, 1, True, log)

    def test_exit_code_change_or_missing_source_signature_is_not_accepted(self):
        log = "Stopping action server...\nExiting action server...\nError executing action-server: exit status 1"
        with self.assertRaisesRegex(RuntimeError, "exit status changed"):
            driver.validate_shutdown(200, 0, False, log)
        with self.assertRaisesRegex(RuntimeError, "interrupt order"):
            driver.validate_shutdown(200, 1, False, "POST /api/shutdown/ 200 OK")
        with self.assertRaisesRegex(RuntimeError, "interrupt order"):
            driver.validate_shutdown(
                200,
                1,
                False,
                "Error executing action-server: exit status 1\n"
                "Stopping action server...\nExiting action server...",
            )

    def test_embedded_rcc_uses_receipt_bound_to_exact_runtime_artifact(self):
        runtime_pin = {"version": "1.1.1", "source": "runtime-source-commit"}
        runtime_sha = "runtime-artifact-sha"
        receipt = {
            "artifacts": {
                "actions_runtime": {
                    "version": "1.1.1",
                    "source_commit": "runtime-source-commit",
                    "downloaded_file_sha256": runtime_sha,
                }
            },
            "runtime_bundled_rcc": {
                "version": "v18.19.8",
                "sha256": "embedded-rcc-sha",
            },
        }
        observed = [{"version": "v18.19.8", "sha256": "embedded-rcc-sha"}]
        self.assertEqual(
            driver.validate_embedded_rcc(receipt, runtime_pin, runtime_sha, observed),
            receipt["runtime_bundled_rcc"],
        )
        with self.assertRaisesRegex(RuntimeError, "not bound to this Runtime"):
            driver.validate_embedded_rcc(receipt, runtime_pin, "wrong-sha", observed)
        with self.assertRaisesRegex(RuntimeError, "did not match its bound"):
            driver.validate_embedded_rcc(
                receipt, runtime_pin, runtime_sha, [{"version": "v18.19.11", "sha256": "other"}]
            )


if __name__ == "__main__":
    unittest.main()
