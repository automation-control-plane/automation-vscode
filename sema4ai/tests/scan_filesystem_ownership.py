"""Repeatable filesystem-name inventory for source and exact VSIX payloads.

The automated gate rejects known extension-owned legacy path literals and flags
new path constructors for review. Identifiers/imports are counted separately;
they are not storage ownership findings. This is not a general security scanner.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


MARKER = re.compile(r"sema4[._-]?ai", re.IGNORECASE)
FORBIDDEN = re.compile(
    r"[\"']\.sema4ai_code[\"']|rcc_env_info_sema4ai\.json|sema4ai_vscode_extension_input_"
    r"|sema4ai_code_env_error_|sema4ai-vscode-actions|sema4ai-\{user\}",
    re.IGNORECASE,
)
CONSTRUCTOR = re.compile(
    r"\b(?:join|joinPath|resolve|Path|expanduser|homedir|mkdtemp|NamedTemporaryFile|mkdir)\s*\("
    r"|\b(?:rootdir|dir_path|cache_dir|mutex_name)\s*=",
)
SUFFIXES = {".py", ".ts", ".js", ".json", ".yaml", ".yml", ".toml", ".sh", ".ps1", ".html", ".css"}


def classify(path: str, line: str) -> tuple[str, str]:
    name = path.replace("\\", "/")
    stripped = line.strip()
    if stripped.startswith(("#", "//", "*")) or (name.endswith("/protocols.py") and stripped.startswith("Usually ")):
        return "documentation", "Retain module/contract documentation; stale storage examples need manual review."
    if FORBIDDEN.search(line):
        return "forbidden_owned_path", "Migrate the extension-owned path and all readers/writers/cleanup."
    if re.search(r"[\"']\.sema4ai[\"']", line):
        if name.endswith(("/runtime_paths.py", "/runtimePaths.ts", "/runtimePaths.js")):
            return "vendor_discovery", "Retain read-only Studio discovery; do not create or clean vendor paths."
        return "unreviewed_path", "Unconditional vendor-named storage is not allowed."
    if re.search(r"[\"']sema4ai[\"']", line) and CONSTRUCTOR.search(line):
        if name.endswith(("/runtime_paths.py", "/runtimePaths.ts", "/runtimePaths.js")):
            return "vendor_discovery", "Retain Windows read-only Studio discovery."
        return "unreviewed_path", "Review the owner of this computed path."
    if "sema4ai-studio" in line:
        return "vendor_discovery", "Retain explicit Studio version/PID compatibility reads."
    if '"Sema4.ai"' in line and any(part in name for part in ("/robo/importActions.", "/robo/actionPackage.", "/robocorp_language_server.py")):
        return "vendor_gallery_namespace", "Retain explicit vendor Gallery workspace content and its reader."
    if name.endswith(("/rccTerminal.ts", "/rccTerminal.js")) and "sema4aiHome" in line:
        return "target_execution_storage", "Terminal files use the resolved runtime home; the historical variable name does not create a vendor path."
    if '"Error importing sema4ai_ls_core. Log: %s"' in line:
        return "identifier_or_display_text", "Join diagnostic text, not a filesystem path."
    if CONSTRUCTOR.search(line):
        if any(fragment in line for fragment in ("src/sema4ai_code", "sema4ai-python-ls-core", '"sema4ai_code"', '"sema4ai_ls_core"')):
            return "installed_module_resource", "Retain installed Python module/resource identity, not user storage."
        if "get_logger(" not in line:
            return "unreviewed_path", "Manually classify this remaining path-constructor match."
    return "identifier_or_display_text", "Module, protocol, setting, branding or text; not a filesystem builder."


def scan_text(path: str, text: str) -> list[dict]:
    matches = []
    for number, line in enumerate(text.splitlines(), 1):
        if not MARKER.search(line):
            continue
        kind, disposition = classify(path, line)
        matches.append({"path": path, "line": number, "classification": kind,
                        "disposition": disposition, "text": line.strip()})
    return matches


def source_files(repository: Path):
    for relative in ("sema4ai/src", "sema4ai/vscode-client/src", "sema4ai/vscode-client/out",
                     "sema4ai-python-ls-core/src", "sema4ai/bin", "sema4ai/scripts",
                     "sema4ai/resources", "sema4ai/codegen"):
        root = repository / relative
        if root.exists():
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.suffix in SUFFIXES and not any(part in {"tests", "unittest_tools", "__pycache__", "node_modules"} for part in path.relative_to(root).parts):
                    yield path
    for relative in ("sema4ai/package.json", "sema4ai/pyproject.toml", "sema4ai/legacy-integrations.json"):
        path = repository / relative
        if path.exists():
            yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--vsix", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.source_root is None and not args.vsix:
        parser.error("Provide --source-root and/or --vsix.")
    report = {"scope": "Source and exact archive static path inventory; not installed runtime acceptance", "inputs": [], "matches": []}
    if args.source_root is not None:
        repository = args.source_root.resolve()
        files = list(source_files(repository))
        report["inputs"].append({"kind": "source", "files": len(files)})
        for path in files:
            report["matches"].extend(scan_text(path.relative_to(repository).as_posix(), path.read_text(encoding="utf-8", errors="replace")))
    for path in args.vsix:
        data = path.read_bytes()
        report["inputs"].append({"kind": "vsix", "filename": path.name, "sha256": hashlib.sha256(data).hexdigest()})
        with zipfile.ZipFile(path) as archive:
            for member in sorted(archive.namelist()):
                if Path(member).suffix in SUFFIXES and not member.endswith("/"):
                    report["matches"].extend(scan_text(path.name + "!" + member, archive.read(member).decode("utf-8", errors="replace")))
    failures = [match for match in report["matches"] if match["classification"] in {"forbidden_owned_path", "unreviewed_path"}]
    report["passed"] = not failures
    report["review_required"] = failures
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "matches": len(report["matches"]), "review_required": len(failures), "output": str(args.output)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
