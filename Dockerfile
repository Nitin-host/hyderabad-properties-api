# API image — does not encode video. Pair with Dockerfile.worker on Railway.
FROM node:20-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /usr/src/app

RUN apk add --no-cache ffmpeg

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV VIDEO_PROCESS_IN_API=false

EXPOSE 5000
CMD ["node", "server.js"]