# Eligibility evaluation, version 1

Separate synthetic dev 10 / holdout 30, authored and frozen before v3 predictions.
The previous `../cases/` files and labels are unchanged. New exact inputs and scene IDs
do not prove semantic independence: related policy patterns occur in both sets and splits.
One AI author; independent human review is pending. No real photos or user text.

Permitted safe finish and useful continuation are distinct. A blocked target can lead to
clarification or finish. Normal supported cases prefer a grooming tip; a safe finish there
is a quality mismatch, not a constraint violation. `support_possible` is measured separately
to reject a system that always finishes. `tools/build_policy_cases.py` contains authored
labels, not labels obtained from the policy or a model. It refuses to overwrite this directory.

v3 first applies code eligibility. A singleton executes without Decider: source `policy`,
raw choice, probabilities and confidence all null. With multiple candidates the actual
question contains only those candidates and scores are conditional on that set. Never
compare those scores directly with the old four-option confidence as calibrated accuracy.
Report model decisions, forced policy decisions and final outcomes separately.
