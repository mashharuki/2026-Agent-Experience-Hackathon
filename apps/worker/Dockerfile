# syntax=docker/dockerfile:1.7
# Worker image for ECS on Fargate (Linux/x86_64, CPU only).
# Build from the repository root so the shared package is in the context:
#   docker build --platform linux/amd64 -f apps/worker/Dockerfile -t photoprep-worker .
# Model weights are downloaded here, at build time, and pinned (see prefetch_models.py).
# Nothing is downloaded when the container runs, and no port is exposed: the worker only
# pulls jobs from SQS.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG UV_VERSION=0.11.14

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM --platform=linux/amd64 ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
WORKDIR /app
# Same relative layout as the repository: apps/worker depends on ../../packages/photoprep-common
COPY packages/photoprep-common packages/photoprep-common
COPY apps/worker/pyproject.toml apps/worker/uv.lock apps/worker/
RUN cd apps/worker && uv sync --frozen --no-dev --no-install-project

FROM build AS models
ENV HF_HOME=/models
COPY apps/worker/scripts/prefetch_models.py /tmp/prefetch_models.py
RUN /opt/venv/bin/python /tmp/prefetch_models.py

FROM --platform=linux/amd64 ${PYTHON_IMAGE} AS runtime
RUN useradd --system --uid 10001 --create-home worker
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app/packages /app/packages
# The Hugging Face cache files are private to the build user; the runtime user must read them.
COPY --chmod=a+rX --from=models /models /models
COPY apps/worker/src /app/apps/worker/src
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app/apps/worker/src \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1
USER worker
CMD ["python", "-m", "photoprep_worker.main"]
