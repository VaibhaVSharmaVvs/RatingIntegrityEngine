"""Pack N reviews into one System One request (MVP_SPEC §6.3), Jev only.

Default is pack=1 (accuracy over cost, PLAN Phase 3). Packing is a *cost* lever: on 5
smoke reviews it cut input tokens by 41% on Jev (MEASUREMENTS M4b). On Laya it is
broken: every item got the same answers (M1b), so it is refused for Laya.

Packed state: {"reviews": [state_0, state_1, ...]}. Each question is copied per item
with an id of `r{i}__{qid}`, and every backticked state field in its instructions
(`review`, `verdict`, ...) is rewritten to that item's path (`reviews[i].review`).
"""

import re

_FIELD = re.compile(r"`(\w+)`")
SEP = "__"


def _retarget(text: str, i: int, fields: set[str]) -> str:
    return _FIELD.sub(
        lambda m: f"`reviews[{i}].{m.group(1)}`" if m.group(1) in fields else m.group(0), text
    )


def _retarget_obj(obj, i: int, fields: set[str]):
    if isinstance(obj, str):
        return _retarget(obj, i, fields)
    if isinstance(obj, list):
        return [_retarget_obj(x, i, fields) for x in obj]
    if isinstance(obj, dict):
        return {k: _retarget_obj(v, i, fields) for k, v in obj.items()}
    return obj


def pack(states: list[dict], questions: dict[str, dict]) -> tuple[dict, dict[str, dict]]:
    fields = set().union(*(s.keys() for s in states))
    packed_q: dict[str, dict] = {}
    for i in range(len(states)):
        for qid, q in questions.items():
            item_q = dict(q)
            item_q["instructions"] = _retarget_obj(q["instructions"], i, fields)
            if "criteria" in q:
                item_q["criteria"] = _retarget_obj(q["criteria"], i, fields)
            packed_q[f"r{i}{SEP}{qid}"] = item_q
    return {"reviews": states}, packed_q


def unpack(answers: dict[str, dict], n: int, questions: dict[str, dict]) -> list[dict[str, dict]]:
    return [{qid: answers[f"r{i}{SEP}{qid}"] for qid in questions} for i in range(n)]
