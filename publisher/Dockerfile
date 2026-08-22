# syntax=docker/dockerfile:1
#
# The `site-publisher` Cloud Run job (spec §8.4 phase 5, issue #36).
#
# The image is a packaging of this repository, nothing more: the logic it
# runs is `scripts/publish-site.cjs`, which lives in the repo precisely so
# `npm test` covers it. Nothing here is client-specific — one image per
# client project, built from the same tree, configured entirely by the
# per-client environment `deploy-client.yml` sets on the job.
#
# Built and pushed by deploy-client.yml's `publisher` job into Artifact
# Registry IN THE CLIENT'S OWN PROJECT. A single shared operator registry
# would mean every client project holds a read grant on an image path
# shared with every other client, and the Cloud Run job would pull across a
# project boundary — §8.4 is explicit that the job runs "under the project's
# own service account" with no cross-project credentials, and the image is
# part of that boundary.
#
# Build context is the repository root:
#   docker build -f publisher/Dockerfile -t <image> .
#
# `functions/vendor/shared.tgz` must exist in the context before the build
# (npm run prepare:functions) — functions/package.json depends on it by
# path, so `npm ci` cannot resolve the workspace tree without it.

FROM node:22-slim

# vite and firebase-tools are devDependencies of the workspace root: the
# job BUILDS the site, so a production-only install has nothing to build
# with.
ENV NODE_ENV=development \
    CI=true \
    # Vite's default heap is fine, but a large schedule plus source maps
    # has run a 512Mi task out of memory before it runs out of time.
    NODE_OPTIONS=--max-old-space-size=1536

WORKDIR /app

# Manifests first, so a content change in the repo does not invalidate the
# install layer.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY functions/package.json functions/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY functions/vendor/shared.tgz functions/vendor/shared.tgz
RUN npm ci

COPY . .

# The job writes inside the image: the vite build emits apps/web/dist,
# `firebase target:apply` writes .firebaserc, and publish-site.cjs patches
# firebase.json's hosting rewrite region for this client. All of it is
# discarded when the execution ends.
RUN chown -R node:node /app
USER node

ENTRYPOINT ["node", "scripts/publish-site.cjs"]
