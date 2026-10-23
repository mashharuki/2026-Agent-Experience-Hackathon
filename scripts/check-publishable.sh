#!/bin/sh
# Pre-publication checks (T102). Run from the repository root before making the repo public
# or submitting. Exits non-zero if something that must not be published is found.
set -u
status=0
fail() { echo "FAIL: $1"; status=1; }
ok() { echo "ok:   $1"; }

# 1. An OSI-approved license is present (MIT).
if [ -f LICENSE ] && head -1 LICENSE | grep -q "MIT License"; then ok "LICENSE is MIT"; else fail "LICENSE is missing or not MIT"; fi

# 2. No tracked photos: only generated diagrams, the cover image and the four app icons may be images.
images=$(git ls-files | grep -iE '\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$' \
  | grep -vE '^docs/architecture/diagrams/snipe-regatta-(system|decision)\.png$' \
  | grep -vE '^docs/brand/regatta/cover(-1280)?\.png$' \
  | grep -vE '^apps/frontend/public/icons/(icon-192|icon-512|icon-maskable-512|apple-touch-icon)\.png$')
if [ -z "$images" ]; then ok "no photos tracked"; else fail "images tracked: $images"; fi
if git ls-files | grep -E '^evaluation/(holdout|dev-examples)/.+\.(jpe?g|png)$' >/dev/null; then
  fail "evaluation images are tracked"; else ok "no evaluation images tracked"; fi

# 3. No secrets or credentials in tracked files.
hits=$(git grep -nIE 'AKIA[0-9A-Z]{16}|aws_secret_access_key|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|xox[baprs]-|ghp_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|AWS_BEARER_TOKEN_BEDROCK=[A-Za-z0-9]' \
  -- . ':!pnpm-lock.yaml' ':!*.lock' ':!scripts/check-publishable.sh' ':!docs/**' ':!specs/**')
if [ -z "$hits" ]; then ok "no credential patterns"; else fail "possible secrets:"; echo "$hits"; fi

# 4. No env files or key material tracked.
if git ls-files | grep -E '(^|/)\.env($|\.)|\.pem$|\.p12$|id_rsa' | grep -vE '\.env\.example$' >/dev/null; then
  fail "env or key files are tracked"; else ok "no env or key files tracked"; fi

# 5. Third-party notices and the decision pattern note exist.
[ -f docs/THIRD_PARTY_NOTICES.md ] && ok "docs/THIRD_PARTY_NOTICES.md present" || fail "docs/THIRD_PARTY_NOTICES.md missing"
[ -f docs/decision-pattern.md ] && ok "docs/decision-pattern.md present" || fail "docs/decision-pattern.md missing"
[ -d apps/worker/src/photoprep_worker/decision_pattern ] && ok "decision_pattern package present" || fail "decision_pattern package missing"

# 6. Required hashtags appear in the README.
for tag in '#strands-decider-2b' '#tool-selection'; do
  grep -q -- "$tag" README.md && ok "README mentions $tag" || fail "README does not mention $tag"
done

exit $status
