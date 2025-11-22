#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-cmux-sandbox-dev}"
PORT="${CMUX_SANDBOX_PORT:-46831}"
CONTAINER_NAME="${CONTAINER_NAME:-cmux-sandbox-dev-run}"

echo "Building ${IMAGE_NAME} from ${ROOT_DIR}/packages/sandbox/Dockerfile"
docker build -t "${IMAGE_NAME}" -f "${ROOT_DIR}/packages/sandbox/Dockerfile" "${ROOT_DIR}"

echo "Starting container ${CONTAINER_NAME} with Docker-in-Docker, buildkit, cmux-sandboxd, and cmux CLI on port ${PORT}"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run --privileged -d \
  --name "${CONTAINER_NAME}" \
  --cgroupns=host \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --dns 1.1.1.1 --dns 8.8.8.8 \
  -e CMUX_SANDBOX_PORT="${PORT}" \
  -p "${PORT}:${PORT}" \
  -v cmux-sandbox-docker:/var/lib/docker \
  -v cmux-sandbox-data:/var/lib/cmux/sandboxes \
  --entrypoint /usr/local/bin/bootstrap-dind.sh \
  "${IMAGE_NAME}" \
  /usr/local/bin/cmux-sandboxd --bind 0.0.0.0 --port "${PORT}" --data-dir /var/lib/cmux/sandboxes

echo "Waiting for cmux-sandboxd to be ready on port ${PORT}..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
    echo "cmux-sandboxd is up!"
    break
  fi
  sleep 0.5
done

echo "Attaching shell; type 'exit' to leave and 'docker stop ${CONTAINER_NAME}' to stop container"
docker exec --detach-keys="ctrl-^" -it -e TERM=xterm-256color "${CONTAINER_NAME}" bash -l
