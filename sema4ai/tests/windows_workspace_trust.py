"""Grant only the authorized synthetic workspace through real Code UI.

No workspace trust settings, trust stores, registry or parent trust are edited.
The CDP endpoint belongs to this task-owned Code profile and is loopback-only.
"""
import argparse
import json
from pathlib import Path
import re
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    root = args.state.resolve(strict=True)
    workspace = root / "workspace"
    if not workspace.is_dir() or workspace.is_symlink():
        raise RuntimeError("Owned synthetic workspace is missing or linked")
    host_receipt = root / "public/installed-host.json"
    receipt = {"scope": "Trust only the task-owned synthetic workspace through native Code UI",
               "parent_trust_selected": False, "trust_enforcement_disabled": False,
               "passed": False}
    destination = root / "public/workspace-trust.json"
    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as playwright:
            deadline = time.monotonic() + 120
            browser = None
            while time.monotonic() < deadline:
                if host_receipt.exists():
                    host = json.loads(host_receipt.read_text())
                    trust = host.get("workspaceTrust", {})
                    if trust.get("enabled") and trust.get("currentWorkspaceGranted"):
                        receipt["passed"] = True
                        receipt["observed_native_workspace_trusted"] = True
                        return
                    if host.get("blocker"):
                        raise RuntimeError("Native host failed before workspace trust completed")
                if browser is None:
                    try:
                        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:18527", timeout=1000)
                        receipt["loopback_code_ui_connected"] = True
                    except Exception:
                        time.sleep(0.2)
                        continue
                for context in browser.contexts:
                    for page in context.pages:
                        if page.is_closed():
                            continue
                        # The only launched folder is root/workspace. Require its
                        # actual path in the trust dialog/editor before any grant.
                        body = page.locator("body").inner_text(timeout=3000)
                        normalized = body.replace("/", "\\").casefold()
                        scoped = str(workspace).replace("/", "\\").casefold() in normalized
                        scoped = scoped or page.get_by_title(str(workspace), exact=True).count() > 0
                        if not scoped:
                            continue
                        receipt["exact_workspace_path_visible"] = True
                        parents = page.get_by_role("checkbox", name=re.compile("parent", re.I))
                        for index in range(parents.count()):
                            if parents.nth(index).is_checked():
                                raise RuntimeError("Parent-folder trust must not be selected")
                        for name in ["Yes, I trust the authors", "Trust"]:
                            button = page.get_by_role("button", name=name, exact=True)
                            if button.count() == 1 and button.is_visible():
                                button.click(timeout=3000)
                                receipt["native_trust_button_clicked"] = True
                                break
                time.sleep(0.2)
            raise RuntimeError("Native Code trust UI did not grant the exact synthetic workspace")
    except Exception as error:
        # Preserve only controlled categories, not browser snapshots or raw logs.
        receipt["blocker_category"] = type(error).__name__
        raise RuntimeError("Native workspace trust UI gate failed; see sanitized receipt") from None
    finally:
        destination.write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    main()
