# Linux image for make local-chat-docker: the real widget (harness dev server + Chromium) and the real connector
# (the hermetic sidecar, Python 3.12) in one container. Same Playwright base and pin as dev/e2e.Dockerfile, plus
# Python tooling. The model is a network call out of the container.
FROM mcr.microsoft.com/playwright:v1.59.1-noble
RUN apt-get update -qq && apt-get install -y -qq git make jq curl python3-pip python3-venv >/dev/null \
 && pip3 install -q --break-system-packages uv \
 && corepack enable && corepack prepare pnpm@8.14.2 --activate \
 && git config --system user.email t@example.com && git config --system user.name t \
 && git config --system --add safe.directory '*'
