"""Portable checks of the Windows harness's subprocess and archive boundaries."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("windows_driver", Path(__file__).with_name("qualify_native_windows.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class WindowsQualificationBoundaries(unittest.TestCase):
    def test_official_versioned_cli_layout_is_resolved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entry = root / "69047191fc/resources/app/out/cli.js"
            entry.parent.mkdir(parents=True)
            entry.write_text("// synthetic official archive layout")
            self.assertEqual(driver.code_cli_entry(root), entry)

    def test_cli_layout_missing_or_ambiguous_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, "missing or ambiguous"):
                driver.code_cli_entry(root)
            legacy = root / "resources/app/out/cli.js"
            legacy.parent.mkdir(parents=True)
            legacy.write_text("// synthetic legacy layout")
            self.assertEqual(driver.code_cli_entry(root), legacy)
            other = root / "69047191fc/resources/app/out/cli.js"
            other.parent.mkdir(parents=True)
            other.write_text("// synthetic second CLI")
            with self.assertRaisesRegex(RuntimeError, "missing or ambiguous"):
                driver.code_cli_entry(root)

    def test_only_system_and_explicit_test_environment_reaches_child(self):
        result = driver.clean_environment({"Path": "test-tools", "SYSTEMROOT": "test-windows",
            "AWS_BEARER_TOKEN_BEDROCK": "synthetic-not-a-credential", "GITHUB_TOKEN": "synthetic",
            "ACTIONS_RUNTIME_TOKEN": "synthetic", "PYTHONPATH": "untrusted-inherited"}, {"HOME": "owned-home"})
        self.assertEqual(result, {"Path": "test-tools", "SYSTEMROOT": "test-windows",
            "PYTHONNOUSERSITE": "1", "PYTHONUTF8": "1", "HOME": "owned-home"})
        with self.assertRaisesRegex(ValueError, "Unapproved QA environment"):
            driver.clean_environment({}, {"GITHUB_TOKEN": "synthetic"})

    def test_archive_traversal_is_refused_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("../outside.txt", "synthetic")
            with self.assertRaisesRegex(ValueError, "escapes"):
                driver.extract_archive(archive, root / "inside")
            self.assertFalse((root / "outside.txt").exists())

    def test_archive_symlink_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "symlink.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                entry = zipfile.ZipInfo("link")
                entry.external_attr = 0o120777 << 16
                zipped.writestr(entry, "outside")
            with self.assertRaisesRegex(ValueError, "symlinks"):
                driver.extract_archive(archive, root / "inside")


if __name__ == "__main__":
    unittest.main()
