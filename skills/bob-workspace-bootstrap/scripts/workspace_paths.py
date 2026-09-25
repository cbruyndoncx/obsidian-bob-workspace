"""Resolve BOB Workspace paths from one vault without another skill library.

The plugin reads its active configuration from its installed ``workspace.json``.
These helpers use the same schema-folder precedence as the plugin and keep
skill-generated files inside the selected vault.
"""

import json
import re
from pathlib import Path

DEFAULT_SCHEMA_SOURCE = "00-CORE/Schemas/source"
DEFAULT_BASES_FOLDER = "00-CORE/Bases"
DEFAULT_REPORTS_FOLDER = "BOB Workspace/Reports"


def _inside_vault(vault: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        raise ValueError(f"expected a vault-relative path, got {value!r}")
    root = vault.resolve()
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"path leaves the vault: {value!r}")
    return resolved


def workspace_config(vault: Path) -> dict:
    path = vault / ".obsidian/plugins/bob-workspace/workspace.json"
    if not path.is_file():
        return {}
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError(f"workspace.json must contain an object: {path}")
    return config


def schema_source(vault: Path) -> Path:
    config = workspace_config(vault)
    schemas = config.get("schemas") or {}
    settings = config.get("settings") or {}
    if not isinstance(schemas, dict) or not isinstance(settings, dict):
        raise ValueError("workspace.json schemas and settings must be objects")
    value = schemas.get("folder") or settings.get("schemasFolder") or DEFAULT_SCHEMA_SOURCE
    if not isinstance(value, str) or not value.strip():
        raise ValueError("workspace.json schema folder must be a nonempty string")
    return _inside_vault(vault, value)


def schema_file(vault: Path, entity: str) -> Path:
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", entity):
        raise ValueError(f"entity must be a kebab-case slug: {entity!r}")
    return schema_source(vault) / f"{entity}.yaml"


def schema_root(vault: Path) -> Path:
    source = schema_source(vault)
    return source.parent if source.name == "source" else source


def bases_folder(vault: Path) -> Path:
    settings = workspace_config(vault).get("settings") or {}
    if not isinstance(settings, dict):
        raise ValueError("workspace.json settings must be an object")
    value = settings.get("basesFolder") or DEFAULT_BASES_FOLDER
    if not isinstance(value, str) or not value.strip():
        raise ValueError("workspace.json basesFolder must be a nonempty string")
    return _inside_vault(vault, value)


def reports_folder(vault: Path) -> Path:
    return _inside_vault(vault, DEFAULT_REPORTS_FOLDER)


def output_path(vault: Path, value: str) -> Path:
    """Resolve a user-supplied output relative to the vault, never process CWD."""
    path = Path(value)
    if path.is_absolute():
        root = vault.resolve()
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise ValueError(f"output path leaves the vault: {value!r}")
        return resolved
    return _inside_vault(vault, value)
