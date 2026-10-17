//! `ymsync-bridge`: the YandexMusicSync core for the patched Yandex Music app.
//! See the library.

#![forbid(unsafe_code)]

use anyhow::Result;
use tokio::io::BufReader;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    // Logs go to stderr: stdout is the protocol.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("ymsync=info,ymsync_bridge=info")),
        )
        .init();

    ymsync_bridge::run(BufReader::new(tokio::io::stdin()), tokio::io::stdout()).await
}
