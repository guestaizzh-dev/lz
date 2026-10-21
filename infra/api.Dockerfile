FROM debian:bookworm-slim AS recorder-build
RUN apt-get update && apt-get install -y --no-install-recommends g++ ca-certificates curl unzip libasound2-dev libv4l-dev && rm -rf /var/lib/apt/lists/*
RUN curl -fL --retry 3 -A 'Mozilla/5.0' -e https://doc-zh.zego.im/ https://artifact-sdk.zego.im/downloads/ZegoRecorder-linux-cpp.zip -o /tmp/recorder.zip \
 && echo 'dff09e9abc599cb0c3fa8fd7032773629502f499eb70b69bb257fc4bacb8a093  /tmp/recorder.zip' | sha256sum -c \
 && unzip -q /tmp/recorder.zip -d /tmp/sdk
COPY services/recorder/recorder.cpp /tmp/recorder.cpp
RUN mkdir -p /opt/zego-recorder && cp /tmp/sdk/ZegoRecorder-linux-cpp/Library/x86_64/libZegoRecorder.so /opt/zego-recorder/ \
 && g++ -std=c++17 -O2 -pthread -I/tmp/sdk/ZegoRecorder-linux-cpp/Library/x86_64/include /tmp/recorder.cpp -L/opt/zego-recorder -lZegoRecorder -Wl,-rpath,'$ORIGIN' -o /opt/zego-recorder/academy-recorder

FROM node:24.18.0-bookworm-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl ffmpeg libasound2 libv4l-0 && rm -rf /var/lib/apt/lists/*
COPY --from=recorder-build /opt/zego-recorder /opt/zego-recorder
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
