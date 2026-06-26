from __future__ import annotations

import yaml


def write(doc: dict) -> str:
    return yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)