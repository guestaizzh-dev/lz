FROM node:24.18.0-bookworm-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api/package.json services/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --filter @daoxue/api --frozen-lockfile
COPY services/api services/api
COPY infra/apple-root-cas infra/apple-root-cas
WORKDIR /workspace/services/api
RUN DATABASE_URL=postgresql://build:unused@127.0.0.1:5432/build pnpm exec prisma generate && pnpm build
RUN chmod a+rx /workspace /workspace/services /workspace/apps /workspace/apps/admin && chmod -R a+rX /workspace/services/api && chmod a+r /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml /workspace/apps/admin/package.json && mkdir -p /data/media && chown node:node /data/media
ENV NODE_ENV=production API_HOST=0.0.0.0 PORT=3000 MEDIA_DIR=/data/media
USER node
CMD ["node", "dist/main.js"]
