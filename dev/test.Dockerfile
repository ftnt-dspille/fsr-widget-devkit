# Linux test image for make test-docker: shell-heavy harness tests run here at
# Linux process-start speed (promoteGate: 3s here vs ~200s on the Mac host).

FROM node:20-bookworm
RUN apt-get update -qq && apt-get install -y -qq git make jq python3 >/dev/null \
 && corepack enable && corepack prepare pnpm@8.14.2 --activate \
 && git config --system user.email t@example.com && git config --system user.name t \
 && git config --system --add safe.directory '*'
