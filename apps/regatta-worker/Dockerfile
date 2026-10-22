# The pinned legacy worker image contains the locked CPU environment and both model
# snapshots. Build it from apps/worker/Dockerfile first, then pass its immutable tag
# or digest as BASE_IMAGE. No weights are downloaded at runtime.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY apps/worker/evaluation /app/apps/worker/evaluation
COPY apps/regatta-worker /app/apps/regatta-worker
USER worker
WORKDIR /app/apps/regatta-worker
CMD ["python", "cloud_probe.py"]
