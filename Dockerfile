# The voice server.
#
# A call is one long-lived WebSocket holding a Gemini Live session, so this is a
# stateful process rather than a request handler — which is exactly why it
# cannot live on the same serverless host as the console.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# The whole workspace, then install.
#
# The tempting version copies each package.json first so the install layer
# caches across source edits. It was here, and it broke: adding a package meant
# adding a line, and three packages were added without one — the image built
# cleanly and then died at boot on ERR_MODULE_NOT_FOUND, which is the worst
# possible place to find out. Correctness beats a cached layer on a two-minute
# build.
COPY . .

RUN pnpm install --frozen-lockfile --filter @vaani/voice-server...

ENV NODE_ENV=production
# Hosts inject the port they want listened on.
ENV VOICE_SERVER_PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@vaani/voice-server", "start"]
