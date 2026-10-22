#!/bin/sh
# Build the spectator SPA and publish it to the SnipeRegattaStack bucket.
# Usage (repository root):
#   AWS_PROFILE=... sh scripts/regatta-publish.sh .local/regatta/stack-outputs.json
# The outputs file comes from `cdk deploy --outputs-file`. It holds no secrets: the
# Cognito client is public (PKCE) and every API route requires a signed-in user.
set -eu
outputs=${1:?outputs file required}
deadline_ms=${REGATTA_DEADLINE_MS:-6000}

read_output() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['SnipeRegattaStack'][sys.argv[2]])" "$outputs" "$1"
}

bucket=$(read_output SiteBucket)
distribution=$(read_output DistributionId)

pnpm --filter regatta-web build
python3 - "$outputs" "$deadline_ms" > apps/regatta-web/dist/config.json <<'PY'
import json, sys
o = json.load(open(sys.argv[1]))["SnipeRegattaStack"]
print(json.dumps({
    "apiUrl": o["ApiUrl"],
    "cognitoDomain": o["CognitoDomain"],
    "clientId": o["ClientId"],
    "scope": o["Scope"],
    "deadlineMs": int(sys.argv[2]),
}, indent=2))
PY

# Hashed assets can be cached; the entry page and config must always be revalidated.
aws s3 sync apps/regatta-web/dist "s3://$bucket" --delete \
  --exclude index.html --exclude config.json --cache-control "public,max-age=31536000,immutable"
aws s3 cp apps/regatta-web/dist/index.html "s3://$bucket/index.html" --cache-control "no-cache"
aws s3 cp apps/regatta-web/dist/config.json "s3://$bucket/config.json" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/index.html" "/config.json" >/dev/null
echo "Published to $(read_output SiteUrl)"
