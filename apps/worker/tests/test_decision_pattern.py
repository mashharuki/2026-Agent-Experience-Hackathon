"""T096/T097: the reusable "typed question -> guarded choice -> the chosen tool runs" pattern.

The pattern package must work without anything else from this app, and the decision must
really decide what runs: only the selected option's handler is ever called.
"""

import ast
import pathlib

import pytest

from photoprep_worker.decision_pattern import (
    Choice,
    Override,
    StrandsDecider,
    TypedQuestion,
    apply_guards,
    example,
    run_decision,
)

QUESTION = TypedQuestion(
    name="route",
    version="v1",
    instructions="Which tool should handle this request?",
    options={"search": "look it up", "ask": "ask the user", "escalate": "hand over to a person"},
)


def choice(selected="search", confidence=0.8):
    probs = {k: 0.1 for k in QUESTION.options}
    probs[selected] = 0.8
    return Choice(selected=selected, probabilities=probs, confidence=confidence)


class StubDecider:
    def __init__(self, selected="search", confidence=0.8):
        self.selected, self.confidence, self.states = selected, confidence, []

    def choose(self, state):
        self.states.append(state)
        return choice(self.selected, self.confidence)


class Recorder:
    """Handlers that record which one ran."""

    def __init__(self):
        self.ran = []
        self.handlers = {name: (lambda n=name: self._run(n)) for name in QUESTION.options}

    def _run(self, name):
        self.ran.append(name)
        return f"{name}-result"


class TestTypedQuestion:
    def test_needs_at_least_two_described_options(self):
        with pytest.raises(ValueError):
            TypedQuestion("q", "v1", "?", {"only": "one option"})
        with pytest.raises(ValueError):
            TypedQuestion("q", "v1", "?", {"a": "x", "b": ""})
        with pytest.raises(ValueError):
            TypedQuestion("q", "v1", "", {"a": "x", "b": "y"})

    def test_option_ids_are_stable_identifiers(self):
        with pytest.raises(ValueError):
            TypedQuestion("q", "v1", "?", {"Not An Id": "x", "b": "y"})


class TestStrandsAdapter:
    class Engine:
        def __init__(self, picked):
            self.picked, self.asked = picked, []

        def ask(self, state, questions):
            self.asked.append((state, questions))
            q = questions["route"]
            probs = dict.fromkeys(q.criteria, 0.1)
            probs[self.picked] = 0.8
            answer = type(
                "A", (), {"choice": self.picked, "probabilities": probs, "confidence": 0.7}
            )()
            return type("R", (), {"answers": {"route": answer}})()

    def test_asks_one_typed_choice_question_with_the_option_descriptions(self):
        engine = self.Engine("ask")
        result = StrandsDecider(engine, QUESTION).choose("the situation")
        state, questions = engine.asked[0]
        assert state == "the situation"
        assert questions["route"].type == "choice"
        assert dict(questions["route"].criteria) == dict(QUESTION.options)
        assert (result.selected, result.confidence) == ("ask", 0.7)

    def test_an_option_outside_the_question_is_an_error(self):
        with pytest.raises(ValueError):
            StrandsDecider(self.Engine("delete_everything"), QUESTION).choose("x")


class TestGuards:
    def test_the_first_guard_that_overrides_wins_and_gives_a_reason(self):
        guards = [
            lambda c, ctx: None,
            lambda c, ctx: Override("ask", "needs_info"),
            lambda c, ctx: Override("escalate", "never_reached"),
        ]
        assert apply_guards(choice("search"), guards, None) == ("ask", "needs_info")

    def test_no_guard_means_the_choice_stands(self):
        assert apply_guards(choice("escalate"), [lambda c, ctx: None], None) == ("escalate", None)

    def test_guards_see_the_choice_and_the_context(self):
        seen = []
        apply_guards(
            choice("search", 0.3), [lambda c, ctx: seen.append((c.confidence, ctx))], {"k": 1}
        )
        assert seen == [(0.3, {"k": 1})]


class TestRunDecision:
    def run(self, decider, guards=(), handlers=None, context=None):
        rec = Recorder()
        decision = run_decision(
            decider=decider,
            question=QUESTION,
            state="state text",
            guards=list(guards),
            context=context,
            handlers=handlers or rec.handlers,
        )
        return decision, rec

    @pytest.mark.parametrize("picked", ["search", "ask", "escalate"])
    def test_the_choice_decides_which_handler_runs_and_only_that_one(self, picked):
        decision, rec = self.run(StubDecider(picked))
        assert rec.ran == [picked]
        assert decision.selected == decision.decider_choice == picked
        assert decision.result == f"{picked}-result"
        assert decision.override_reason is None

    def test_a_guard_override_changes_what_runs_and_is_recorded(self):
        decision, rec = self.run(
            StubDecider("search"), guards=[lambda c, ctx: Override("ask", "needs_info")]
        )
        assert rec.ran == ["ask"]
        assert (decision.decider_choice, decision.selected, decision.override_reason) == (
            "search",
            "ask",
            "needs_info",
        )

    def test_the_trace_carries_what_the_decider_said(self):
        decision, _ = self.run(StubDecider("ask", 0.55))
        assert decision.question_version == "v1"
        assert decision.confidence == 0.55
        assert set(decision.probabilities) == set(QUESTION.options)

    def test_a_decider_failure_is_not_replaced_by_a_default(self):
        class Broken:
            def choose(self, state):
                raise RuntimeError("model down")

        rec = Recorder()
        with pytest.raises(RuntimeError):
            run_decision(
                decider=Broken(),
                question=QUESTION,
                state="s",
                guards=[],
                context=None,
                handlers=rec.handlers,
            )
        assert rec.ran == []  # no handler ran on a guess

    def test_every_option_must_be_wired_to_a_handler(self):
        rec = Recorder()
        missing = {k: v for k, v in rec.handlers.items() if k != "escalate"}
        with pytest.raises(ValueError):
            self.run(StubDecider(), handlers=missing)
        with pytest.raises(ValueError):
            self.run(StubDecider(), handlers={**rec.handlers, "extra": lambda: None})

    def test_a_guard_cannot_route_to_an_option_that_does_not_exist(self):
        with pytest.raises(ValueError):
            self.run(StubDecider("search"), guards=[lambda c, ctx: Override("nope", "bad")])

    def test_the_decider_gets_the_state_text_and_nothing_else(self):
        decider = StubDecider()
        self.run(decider)
        assert decider.states == ["state text"]


def test_the_pattern_package_depends_on_nothing_else_in_this_app():
    root = pathlib.Path(__file__).resolve().parents[1] / "src/photoprep_worker/decision_pattern"
    offenders = []
    for path in root.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            if isinstance(node, ast.ImportFrom) and node.level >= 2:
                offenders.append((path.name, "relative import above the package"))
            if (
                module
                and module.startswith("photoprep_worker")
                and not module.startswith("photoprep_worker.decision_pattern")
            ):
                offenders.append((path.name, module))
            if isinstance(node, ast.Import):
                offenders += [
                    (path.name, a.name) for a in node.names if a.name.startswith("photoprep_")
                ]
    assert offenders == []


def test_the_documented_example_runs_and_shows_the_decision_changing_the_action():
    outcomes = example.demo()
    assert {o["decider_choice"] for o in outcomes} == {"search_docs", "ask_user", "escalate"}
    assert all(o["ran"] == [o["selected"]] for o in outcomes)  # exactly the chosen tool ran
    assert any(o["override_reason"] for o in outcomes)  # and one case shows a guard taking over
