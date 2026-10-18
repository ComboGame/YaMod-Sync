//! Asking a relay which rooms it holds, the way the phone's join form does.

use std::time::Duration;

use ymsync::link::{Identity, Link, RoomsError, list_rooms};

const TOKEN: &str = "rooms-token";

async fn join(url: &str, room: &str, name: &str) -> Link {
    let (link, _events) = Link::connect_as(
        url,
        room,
        TOKEN,
        name,
        Identity {
            client_id: format!("{name}-id"),
            plus: Some(true),
        },
        Duration::from_secs(5),
    )
    .await
    .expect("join");
    link
}

#[tokio::test(flavor = "multi_thread")]
async fn rooms_are_listed_with_who_is_in_them() {
    let relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let _a = join(&url, "дом", "Рома").await;
    let _b = join(&url, "работа", "Лена").await;
    let _c = join(&url, "дом", "Миша").await;

    let rooms = list_rooms(&url, TOKEN).await.expect("rooms");
    let names: Vec<&str> = rooms.iter().map(|room| room.name.as_str()).collect();
    assert_eq!(names, ["дом", "работа"], "the busiest first");
    assert_eq!(rooms[0].listeners, ["Рома", "Миша"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_password_lists_nothing() {
    let relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let error = list_rooms(&url, "wrong").await.expect_err("refused");
    assert_eq!(error, RoomsError::Unauthorized);
    assert_eq!(error.to_string(), "неверный пароль");
}

/// A relay from before the room list: it takes the request for a hello that
/// never comes and says nothing. The answer must not take longer than the form
/// is willing to wait.
#[tokio::test(flavor = "multi_thread")]
async fn an_old_relay_lists_nothing_and_says_so() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let _ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
    });

    let started = std::time::Instant::now();
    let error = list_rooms(&url, TOKEN).await.expect_err("silent");
    assert_eq!(error, RoomsError::OldRelay);
    assert!(started.elapsed() < Duration::from_millis(6_500), "{:?}", started.elapsed());
}

#[tokio::test(flavor = "multi_thread")]
async fn nobody_listening_is_said_plainly() {
    let error = list_rooms("ws://127.0.0.1:1", TOKEN).await.expect_err("no server");
    assert!(matches!(error, RoomsError::Unreachable(_)), "{error:?}");
    assert!(error.to_string().starts_with("не удалось подключиться к серверу"), "{error}");
}
