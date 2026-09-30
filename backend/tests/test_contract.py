import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import export_types  # noqa: E402


def test_frontend_schema_is_up_to_date(tmp_path: Path, monkeypatch) -> None:
    """Fails when app/models.py changed without re-running tools/export_types.py."""
    out = tmp_path / "schema.json"
    monkeypatch.setattr(export_types, "OUT", out)
    export_types.main()
    committed = json.loads(
        export_types.Path(ROOT / "frontend/src/data/api.schema.json").read_text()
    )
    assert json.loads(out.read_text()) == committed, (
        "run: uv run python ../tools/export_types.py && (cd ../frontend && npm run gen:types)"
    )
