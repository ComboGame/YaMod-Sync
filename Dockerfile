# ymsync-relay — комната для совместного прослушивания, для VDS.
#
# Собирается только релей: у него нет ни звука, ни TLS, ни зависимостей на C,
# поэтому образ — это один бинарь поверх debian-slim. Гайд: docs/vds-docker.md.

FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Кэш реестра и target переживает пересборку, так что после `git pull`
# компилируется только то, что поменялось.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p ymsync-relay --bin ymsync-relay \
 && cp target/release/ymsync-relay /usr/local/bin/ymsync-relay

FROM debian:bookworm-slim
RUN useradd --system --no-create-home --shell /usr/sbin/nologin ymsync
COPY --from=build /usr/local/bin/ymsync-relay /usr/local/bin/ymsync-relay
USER ymsync
EXPOSE 8787
ENV RUST_LOG=ymsync_relay=info
# Порт открыт — значит релей жив. HTTP-запрос тут не подходит: он отвечает
# только на WebSocket.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8787"]
ENTRYPOINT ["ymsync-relay"]
# Токен комнаты — из переменной YMSYNC_ROOM_TOKEN.
CMD ["--bind", "0.0.0.0:8787", "--no-discovery", "--no-lan-share"]
