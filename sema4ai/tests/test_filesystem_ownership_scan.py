"""Path inventory gate checks, independent of an editor or build environment."""

import importlib.util
from pathlib import Path


spec = importlib.util.spec_from_file_location("filesystem_ownership_scan", Path(__file__).with_name("scan_filesystem_ownership.py"))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def test_released_owned_storage_paths_fail_the_scan():
    for text in (
        'cache_dir = os.path.join(user_home, ".sema4ai", ".cache")',
        'path.join(robocorpHome, ".sema4ai_code")',
        'path.join(spaceInfoPath, "rcc_env_info_sema4ai.json")',
        '`sema4ai_vscode_extension_input_${nameSlugified}.json`',
        'prefix="sema4ai_code_env_error_"',
        'Path(gettempdir()) / "sema4ai-vscode-actions"',
        'rootdir = temproot / f"sema4ai-{user}"',
    ):
        row = scanner.scan_text("extension/src/sema4ai_code/example.py", text)[0]
        assert row["classification"] in {"forbidden_owned_path", "unreviewed_path"}, text


def test_vendor_discovery_and_installed_resources_remain_explicitly_classified():
    assert scanner.classify("extension/src/sema4ai_code/runtime_paths.py", 'return Path.home() / ".sema4ai"')[0] == "vendor_discovery"
    assert scanner.classify("extension/src/sema4ai_code/runtime_paths.py", 'return Path(os.environ["LOCALAPPDATA"]) / "sema4ai"')[0] == "vendor_discovery"
    assert scanner.classify("extension/vscode-client/out/runtimePaths.js", 'return path.win32.join(env.LOCALAPPDATA, "sema4ai");')[0] == "vendor_discovery"
    assert scanner.classify("extension/vscode-client/src/runtimePaths.ts", 'return path.posix.join(env.HOME || os.homedir(), ".sema4ai");')[0] == "vendor_discovery"
    assert scanner.classify("extension/vscode-client/out/extension.js", 'const versionTxtPath = path.join(sema4aiHome, "sema4ai-studio", "version.txt");')[0] == "vendor_discovery"
    assert scanner.classify("extension/vscode-client/out/robo/actionPackage.js", 'dirName = path.join(packageInfo.directory, "actions", "Sema4.ai");')[0] == "vendor_gallery_namespace"
    assert scanner.classify("extension/vscode-client/out/debugger.js", 'path.resolve(__dirname, "../../src/sema4ai_code_debug_adapter/__main__.py")')[0] == "installed_module_resource"
    assert scanner.classify("extension/src/helper.py", 'cache_dir = Path.home() / ".sema4ai" / "cache"')[0] == "unreviewed_path"


def test_new_vendor_named_path_constructor_requires_review():
    assert scanner.classify("extension/src/helper.py", 'root = Path(home) / "sema4ai"')[0] == "unreviewed_path"
    assert scanner.classify("extension/src/helper.py", 'root = Path(home) / "sema4ai-studio" / "cache"')[0] == "unreviewed_path"


def test_computed_vendor_paths_and_user_directories_cannot_pass_as_resources():
    computed = scanner.scan_text(
        "extension/src/helper.py",
        'vendor = "sema4ai"\ncache_dir = Path.home() / vendor / "cache"\ncache_dir.mkdir(parents=True, exist_ok=True)',
    )
    assert any(row["classification"] in {"forbidden_owned_path", "unreviewed_path"} for row in computed)
    user_directory = scanner.scan_text(
        "extension/src/helper.py",
        'cache_dir = Path.home() / "sema4ai_code"\ncache_dir.mkdir(parents=True, exist_ok=True)',
    )
    assert any(row["classification"] in {"forbidden_owned_path", "unreviewed_path"} for row in user_directory)


def test_installed_resource_exemption_requires_an_installation_anchor():
    classification, _ = scanner.classify(
        "extension/src/helper.py", 'cache_dir = Path.home() / "sema4ai_code"'
    )
    assert classification != "installed_module_resource"
