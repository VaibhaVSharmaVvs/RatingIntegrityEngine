"""Export the API/SSE contract (backend/app/models.py) as JSON Schema for the frontend.

Usage (from backend/):  uv run python ../tools/export_types.py
Then (from frontend/):  npm run gen:types
"""

import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import models

OUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "data" / "api.schema.json"

REQUESTS = {models.RunCreate, models.SteamFetchRequest}  # defaults stay optional

EXPORTED = [
    models.RunCreate,
    models.RunOut,
    models.RunSummary,
    models.DatasetOut,
    models.DatasetDetail,
    models.HourIndex,
    models.PreflightOut,
    models.ClusterOut,
    models.ClusterDetail,
    models.ReviewDetail,
    models.ReviewPage,
    models.RunScores,
    models.CsvPreview,
    models.SteamFetchRequest,
    models.ReplayLine,
    models.StageEvent,
    models.FeaturesDoneEvent,
    models.JudgedEvent,
    models.CountersEvent,
    models.RatingEvent,
    models.ClusterEvent,
    models.DoneEvent,
    models.ErrorEvent,
]


def _strip_field_titles(node: object) -> None:
    """Pydantic titles every field; json2ts would turn each into a named alias."""
    if isinstance(node, dict):
        for prop in node.get("properties", {}).values():
            prop.pop("title", None)
        if "prefixItems" in node:  # draft 2020 tuples -> draft-07 form json2ts understands
            node["items"] = node.pop("prefixItems")
        for value in node.values():
            _strip_field_titles(value)
    elif isinstance(node, list):
        for item in node:
            _strip_field_titles(item)


def main() -> None:
    _, schema = models_json_schema(
        [(m, "validation" if m in REQUESTS else "serialization") for m in EXPORTED],
        title="RIE API",
        ref_template="#/$defs/{model}",
    )
    # A top-level object that references every model makes json-schema-to-typescript
    # emit a named interface for each of them.
    defs = schema["$defs"]
    for d in defs.values():
        _strip_field_titles(d)
    schema["type"] = "object"
    schema["properties"] = {name: {"$ref": f"#/$defs/{name}"} for name in sorted(defs)}
    schema["additionalProperties"] = False
    schema["$defs"]["ActionCode"] = {
        "title": "ActionCode",
        "description": "Grid byte per review: "
        + ", ".join(f"{c.value}={c.name}" for c in models.ActionCode),
        "type": "integer",
        "enum": [c.value for c in models.ActionCode],
    }
    schema["properties"]["ActionCode"] = {"$ref": "#/$defs/ActionCode"}
    OUT.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({len(defs)} models)")


if __name__ == "__main__":
    main()
