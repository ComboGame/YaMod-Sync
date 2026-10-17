//! Standalone relay: a thin wrapper around [`ymsync_relay::bind`].
//!
//! The room logic lives in the library, because a player can now host a room in
//! its own process. This binary is what you run when nobody's app should have to
//! stay open — a spare machine holding the room — and it is what the integration
//! tests drive.

#![forbid(unsafe_code)]

use anyhow::{Context, Result};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(
    name = "ymsync-relay",
    version,
    about = "Holds a room's Yandex Music queue and playhead, and keeps its players in step"
)]
struct Args {
    /// Address to listen on. Keep it on localhost or a LAN address; put a TLS
    /// reverse proxy in front before exposing it to the internet.
    #[arg(long, default_value = "127.0.0.1:8787")]
    bind: String,

    /// Shared secret every client must present. Falls back to the
    /// YMSYNC_ROOM_TOKEN environment variable.
    #[arg(long)]
    token: Option<String>,

    /// Не отвечать на широковещательные запросы «кто держит комнаты»
    ///
    /// По умолчанию релей отвечает: так клиенты находят комнату сами, командой
    /// `ymsync rooms`. В ответе только имена комнат и число слушателей — ни
    /// токена, ни того, что играет. С этим ключом комната остаётся доступной
    /// тем, кому адрес назвали руками, и невидимой для поиска.
    #[arg(long)]
    no_discovery: bool,

    /// Не передавать участникам адреса для раздачи треков по локальной сети
    ///
    /// Для релея в интернете, например на VDS. Адрес, с которого пришло
    /// соединение, там — адрес роутера участника или обратного прокси, и его
    /// файловый сервер оттуда не достать: остальные только ждали бы таймаута,
    /// прежде чем пойти за треком в Яндекс. С этим ключом каждый берёт трек
    /// сам — с диска или из своего аккаунта. Можно задать и переменной
    /// YMSYNC_NO_LAN_SHARE=1.
    #[arg(long)]
    no_lan_share: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("ymsync_relay=info")),
        )
        .init();

    let args = Args::parse();
    let token = args
        .token
        .or_else(|| std::env::var("YMSYNC_ROOM_TOKEN").ok())
        .filter(|t| !t.is_empty())
        .context(
            "не задан токен комнаты: передайте --token <секрет> или переменную \
             YMSYNC_ROOM_TOKEN. То же значение впишите игрокам в room_token",
        )?;

    let no_lan_share = args.no_lan_share || env_flag("YMSYNC_NO_LAN_SHARE");
    let options = ymsync_relay::Options {
        discoverable: !args.no_discovery,
        lan_share: !no_lan_share,
    };
    let mut server = ymsync_relay::bind_opts(&args.bind, token, options).await?;

    // Ctrl-C closes the sockets rather than having the process vanish out from
    // under its peers, which is what the embedded relay does too.
    stop_requested().await?;
    tracing::info!("stopping");
    server.stop().await;
    Ok(())
}

/// `1`, `true`, `yes` or `on`, in any case.
fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// Ctrl-C, or SIGTERM on Unix. The latter is what `docker stop` and systemd
/// send, and a process running as PID 1 in a container has no default handler
/// for it: without this, the container would sit out the grace period and be
/// killed.
async fn stop_requested() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).context("listening for SIGTERM")?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.context("waiting for Ctrl-C")?,
            _ = term.recv() => {}
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.context("waiting for Ctrl-C")
    }
}
