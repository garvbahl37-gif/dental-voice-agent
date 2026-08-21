# The voice server.
#
# A call is one long-lived WebSocket holding a Gemini Live session, so this is a
# stateful process rather than a request handler — which is exactly why it
# cannot live on the same serverless host as the console.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# Workspace manifests first, so a code change does not re-resolve the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json      packages/shared/
COPY packages/core/package.json        packages/core/
COPY packages/providers/package.json   packages/providers/
COPY packages/agent/package.json       packages/agent/
COPY packages/live/package.json        packages/live/
COPY packages/db/package.json          packages/db/
COPY packages/telephony/package.json   packages/telephony/
COPY apps/voice-server/package.json    apps/voice-server/

# NOTE: a new workspace package the voice server depends on needs a line above.
# The filtered install resolves workspace links from these manifests, so a
# missing one fails the build here rather than at runtime — loudly, at least.

RUN pnpm install --frozen-lockfile --filter @vaani/voice-server...

COPY packages/ packages/
COPY apps/voice-server/ apps/voice-server/

ENV NODE_ENV=production
# Hosts inject the port they want listened on.
ENV VOICE_SERVER_PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@vaani/voice-server", "start"]
