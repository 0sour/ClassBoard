# ============================================================
# ClassBoard · 单容器镜像（技术设计文档 7.1）
# 构建阶段：node:22-alpine + python3/make/g++，编译前端与 better-sqlite3
# 运行阶段：node:22-alpine，非 root 运行，同容器静态托管前端产物
# 多架构：docker buildx build --platform linux/amd64,linux/arm64
# ============================================================
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
# NAS 直连外网不稳定（node-gyp headers 下载超时）；构建阶段走宿主机 clash 代理。
# 依赖 build.network: host（docker-compose.yml），容器内 127.0.0.1 即宿主机。
ARG HTTP_PROXY=http://127.0.0.1:7890
ARG HTTPS_PROXY=http://127.0.0.1:7890
ARG NO_PROXY=localhost,127.0.0.1
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY \
    http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY no_proxy=$NO_PROXY
WORKDIR /app

# 依赖分层缓存：仅两份 package 文件先装依赖
COPY frontend/package.json frontend/package-lock.json /app/frontend/
COPY server/package.json server/package-lock.json /app/server/
RUN cd /app/frontend && npm ci
RUN cd /app/server && npm ci

# 前端构建（vue-tsc 类型检查 + vite 产物；mupdf WASM 随 dist 懒加载）
COPY frontend/ /app/frontend/
COPY server/ /app/server/
RUN cd /app/frontend && npm run build

# 运行阶段裁剪：仅保留服务端生产依赖，前端只需 dist 静态产物
RUN cd /app/server && npm prune --omit=dev

# ---------- 运行阶段 ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=build /app/server /app/server
COPY --from=build /app/frontend/dist /app/frontend/dist

USER node
WORKDIR /app/server
EXPOSE 3000
VOLUME /app/data

# busybox wget 健康检查（技术设计 7.1）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/context >/dev/null 2>&1 || exit 1

CMD ["node", "index.js"]
