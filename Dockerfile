# syntax=docker/dockerfile:1

# Build: instala tudo e compila o cliente (public/). Nada daqui sobe para a imagem final.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:client

# Runtime: só dependências de produção, o servidor e o bundle do cliente.
FROM oven/bun:1 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7799 \
    DB_PATH=data/nerd-watch.db \
    TORRENT_PATH=data/torrents
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/public ./public
COPY src ./src

# Usuário sem privilégio; só o diretório de dados é gravável.
# ffmpeg (com ffprobe) do repositório Debian, assinado pelo apt: conversão de MKV/AVI/etc. Sem ele o app segue igual.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app \
 && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
 && mkdir -p /app/data \
 && chown -R app:app /app/data
USER app

VOLUME ["/app/data"]
EXPOSE 7799

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 7799) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["bun", "src/server/index.ts"]
