# Linux e2e image for make test-e2e-docker: the official Playwright image (browsers and system libraries included),
# pinned to the exact @playwright/test version in fortisoar-widget-harness/pnpm-lock.yaml (a version bump needs this
# tag bumped with it), plus the toolchain the harness needs.
FROM mcr.microsoft.com/playwright:v1.59.1-noble
RUN apt-get update -qq && apt-get install -y -qq git make jq >/dev/null \
 && corepack enable && corepack prepare pnpm@8.14.2 --activate \
 && git config --system user.email t@example.com && git config --system user.name t \
 && git config --system --add safe.directory '*'
