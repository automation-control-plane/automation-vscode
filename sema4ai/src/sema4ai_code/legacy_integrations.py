"""Backend policy for explicitly enabled external vendor integrations."""
from functools import lru_cache
import json
from pathlib import Path

DISABLED = (
    "External vendor integrations are disabled. Local Automation packages, run/debug "
    "and Work Items do not require them. Legacy services require explicit "
    "sema4ai.legacyVendorIntegrations.enabled configuration."
)


def enabled(config) -> bool:
    return config is not None and config.get_setting(
        "sema4ai.legacyVendorIntegrations.enabled", bool, False
    )


@lru_cache(maxsize=1)
def commands() -> frozenset[str]:
    from sema4ai_code import get_extension_relative_path
    value = json.loads(Path(get_extension_relative_path("legacy-integrations.json")).read_text("utf-8"))
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise RuntimeError("Invalid legacy integration command manifest.")
    return frozenset(value)
