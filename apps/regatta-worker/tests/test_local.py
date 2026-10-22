import json
import time
from types import SimpleNamespace

import pytest

from benchmark import observation
from local_server import Observation, choose, options_for, validate_request


def packet(case=1):
    obs = observation(case)
    return {
        "raceId": "test",
        "epoch": 0,
        "seq": case,
        "boatId": obs["boat"]["id"],
        "expiresAt": time.time() * 1000 + 3000,
        "observation": obs,
    }


def test_validates_current_snapshot_without_future_fields():
    request = validate_request(json.dumps(packet()).encode())
    assert request.boatId == request.observation.boat.id
    invalid = packet()
    invalid["observation"]["seed"] = 42
    with pytest.raises(ValueError):
        validate_request(json.dumps(invalid).encode())


@pytest.mark.parametrize("change", ["identity", "others", "expired", "nan", "course"])
def test_rejects_corrupt_or_expired_requests(change):
    value = packet()
    if change == "identity":
        value["boatId"] = "aurora"
    elif change == "others":
        value["observation"]["others"][0]["id"] = value["boatId"]
    elif change == "expired":
        value["expiresAt"] = time.time() * 1000 - 1
    elif change == "nan":
        value["observation"]["boat"]["x"] = float("nan")
    else:
        value["observation"]["mark"]["y"] = 900
    with pytest.raises(ValueError):
        validate_request(json.dumps(value).encode())


def test_options_are_legal_and_visible_only():
    obs = Observation.model_validate(observation(3))
    assert "tack_now" in options_for(obs)
    assert "approach_mark" in options_for(obs)
    assert "jibe_now" not in options_for(obs)
    assert "seek_visible_pressure_gust_999" not in options_for(obs)
    obs.boat.leg = "downwind"
    assert "jibe_now" in options_for(obs)
    assert "tack_now" not in options_for(obs)
    obs.boat.leg = "finished"
    assert list(options_for(obs)) == ["hold_course"]


def test_adapter_validates_scores_and_contains_no_prediction():
    class Engine:
        def ask(self, state, question):
            assert "prediction" not in state
            assert "seed" not in state
            assert "Current plan" in state
            assert list(question) == ["choose_sailing_tactic"]
            ids = list(options_for(Observation.model_validate(observation(1))))
            return SimpleNamespace(
                answers={
                    "choose_sailing_tactic": SimpleNamespace(
                        choice=ids[0],
                        probabilities={key: float(key == ids[0]) for key in ids},
                        confidence=0.8,
                    )
                }
            )

    result = choose(Engine(), Observation.model_validate(observation(1)))
    assert result["source"] == "decider"
    assert result["selected"] == "hold_course"


def test_draft_contract_matches_request_fields():
    from pathlib import Path

    import yaml

    from local_server import Request

    root = Path(__file__).resolve().parents[3]
    contract = yaml.safe_load(
        (root / "specs/003-regatta-spectator/contracts/local-experiment.yaml").read_text()
    )
    schema = Request.model_json_schema()
    assert contract["components"]["schemas"]["Request"]["required"] == schema["required"]
    assert (
        contract["components"]["schemas"]["Observation"]["required"]
        == schema["$defs"]["Observation"]["required"]
    )
    assert contract["components"]["schemas"]["Observation"]["additionalProperties"] is False
