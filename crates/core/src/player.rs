//! Desktop audio output.
//!
//! A track is decoded either from memory — a download, a file on disk — or from
//! a download still in progress, so playback starts on the first part instead
//! of after the whole file. Playback speed is deliberately left at 1.0: `rodio`
//! scales its reported position by playback speed, so nudging the rate would
//! corrupt the very measurement the sync loop corrects against — and it would
//! bend the pitch as well.

use std::io::{Cursor, Read, Seek};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use bytes::Bytes;
use rodio::decoder::DecoderBuilder;
use rodio::mixer::MixerSource;
use rodio::{OutputStream, OutputStreamBuilder, Sink, Source, cpal};
use ymsync_proto::TrackRef;

use crate::playback::{AudioSource, Playback};
use crate::stream::Progressive;

/// How long a seek into a part still downloading may wait for it.
const SEEK_WAIT: Duration = Duration::from_secs(120);

/// Slack on top of the estimated byte offset of a seek target: the estimate
/// assumes a constant bitrate, and the decoder reads a little ahead.
const SEEK_MARGIN_BYTES: usize = 128 * 1024;

pub struct Player {
    sink: Arc<Sink>,
    current: Mutex<Option<TrackRef>>,
    /// The download the current track plays from, while it is one.
    stream: Mutex<Option<Progressive>>,
    /// Bumped on every load, so a seek that waited for data can tell whether the
    /// track it was meant for is still the one playing.
    generation: Arc<AtomicU64>,
    seeker: mpsc::Sender<SeekJob>,
    /// Tells the audio thread to close the device when the player goes.
    audio: mpsc::Sender<AudioEvent>,
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.audio.send(AudioEvent::Closed);
    }
}

/// A seek into a part of the track that has not downloaded yet.
struct SeekJob {
    generation: u64,
    to: Duration,
    stream: Progressive,
    need_bytes: usize,
}

/// The sink's own mixer output, which whatever device stream is open pulls from.
///
/// A device can disappear under a playing track — Bluetooth headphones switched
/// off, and the phone moves to its speaker. The old stream is then dead and a
/// new one has to be opened; because the sink is attached to this mixer rather
/// than to the stream's, the new stream carries on from the same sample, with
/// the track, its position and any pending seek untouched. Without it the sink
/// stopped being pulled, and its `try_seek` and `clear` — which wait for the
/// audio thread — hung the sync loop for good.
#[derive(Clone)]
struct SharedOutput {
    source: Arc<Mutex<MixerSource>>,
    channels: rodio::ChannelCount,
    sample_rate: rodio::SampleRate,
}

impl SharedOutput {
    fn new(source: MixerSource) -> Self {
        Self {
            channels: source.channels(),
            sample_rate: source.sample_rate(),
            source: Arc::new(Mutex::new(source)),
        }
    }

    /// A source for one device stream to play.
    fn handle(&self) -> OutputHandle {
        OutputHandle(self.clone())
    }
}

struct OutputHandle(SharedOutput);

impl Iterator for OutputHandle {
    type Item = f32;

    /// Silence while the sink has nothing: a source that ends is dropped by the
    /// stream, and the next track would then have nowhere to play.
    fn next(&mut self) -> Option<f32> {
        Some(self.0.source.lock().expect("audio mutex").next().unwrap_or(0.0))
    }
}

impl Source for OutputHandle {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> rodio::ChannelCount {
        self.0.channels
    }

    fn sample_rate(&self) -> rodio::SampleRate {
        self.0.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// What the audio thread hears about its device stream.
enum AudioEvent {
    /// The device went away (headphones off); open whichever is current now.
    Lost,
    /// The player is gone.
    Closed,
}

/// Keeps a device stream open, replacing it when it is lost, until the player
/// closes. The phone makes a player for every room it joins: one left behind
/// held its device open for good.
fn keep_output<S>(
    first: S,
    events: &mpsc::Receiver<AudioEvent>,
    mut open: impl FnMut() -> Result<S, String>,
    settle: Duration,
    retry: Duration,
) {
    let mut stream = Some(first);
    while let Ok(AudioEvent::Lost) = events.recv() {
        // The old stream goes first: two pulling at once would play the track
        // at double speed.
        drop(stream.take());
        std::thread::sleep(settle);
        // One route change is reported more than once.
        loop {
            match events.try_recv() {
                Ok(AudioEvent::Lost) => continue,
                Ok(AudioEvent::Closed) => return,
                Err(_) => break,
            }
        }
        tracing::info!("audio output lost, opening the current one");
        loop {
            match open() {
                Ok(new) => {
                    stream = Some(new);
                    break;
                }
                Err(err) => {
                    tracing::warn!("no audio output yet: {err}");
                    if let Ok(AudioEvent::Closed) = events.recv_timeout(retry) {
                        return;
                    }
                }
            }
        }
    }
}

/// Opens the default output device and starts it playing `output`. A lost
/// device is reported on `lost`, for the audio thread to open another.
fn open_output(output: Option<&SharedOutput>, lost: &mpsc::Sender<AudioEvent>) -> Result<OutputStream, String> {
    let lost = lost.clone();
    let mut stream = OutputStreamBuilder::from_default_device()
        .map_err(|err| err.to_string())?
        .with_error_callback(move |err| match err {
            cpal::StreamError::DeviceNotAvailable => {
                let _ = lost.send(AudioEvent::Lost);
            }
            other => tracing::warn!("audio output: {other}"),
        })
        .open_stream_or_fallback()
        .map_err(|err| err.to_string())?;
    stream.log_on_drop(false);
    if let Some(output) = output {
        stream.mixer().add(output.handle());
    }
    Ok(stream)
}

/// How long to let the system settle on its new route before opening it.
const REOPEN_DELAY: Duration = Duration::from_millis(300);

/// Between attempts while no device will open.
const REOPEN_RETRY: Duration = Duration::from_secs(1);

impl Player {
    pub fn new(volume: f32) -> Result<Self> {
        // cpal's stream is not `Send` on every platform, so the output device is
        // opened on its own thread, which keeps it open while the player lives
        // and opens a new one when it is lost. Only the `Sink` handle crosses
        // threads.
        let (tx, rx) = mpsc::channel::<Result<Sink, String>>();
        let (audio, events) = mpsc::channel::<AudioEvent>();
        let lost_tx = audio.clone();
        std::thread::Builder::new()
            .name("ymsync-audio".to_string())
            .spawn(move || {
                let first = match open_output(None, &lost_tx) {
                    Ok(stream) => stream,
                    Err(err) => {
                        let _ = tx.send(Err(err));
                        return;
                    }
                };
                // The mixer takes the device's format, so the first stream does
                // not have to convert it.
                let (mixer, source) =
                    rodio::mixer::mixer(first.config().channel_count(), first.config().sample_rate());
                let output = SharedOutput::new(source);
                first.mixer().add(output.handle());
                if tx.send(Ok(Sink::connect_new(&mixer))).is_err() {
                    return;
                }
                drop(tx);

                keep_output(first, &events, || open_output(Some(&output), &lost_tx), REOPEN_DELAY, REOPEN_RETRY);
            })
            .context("spawning the audio thread")?;

        let sink = rx
            .recv()
            .context("the audio thread stopped before handing back a sink")?
            .map_err(|err| anyhow!("cannot open the default audio output: {err}"))?;

        sink.set_volume(volume.clamp(0.0, 2.0));
        sink.pause();

        let sink = Arc::new(sink);
        let generation = Arc::new(AtomicU64::new(0));
        let seeker = spawn_seeker(Arc::clone(&sink), Arc::clone(&generation))?;

        Ok(Self {
            sink,
            current: Mutex::new(None),
            stream: Mutex::new(None),
            generation,
            seeker,
            audio,
        })
    }

    /// Decodes without opening an audio device, returning the track's duration
    /// when the decoder can determine it. Used by `ymsync probe` to prove the
    /// downloaded bytes are really playable audio.
    pub fn probe_decode(data: Bytes) -> Result<Option<Duration>> {
        let len = data.len() as u64;
        Ok(build_decoder(Cursor::new(data), Some(len))
            .context("decoding the downloaded audio")?
            .total_duration())
    }

    /// Where in the file `to` probably is. Assumes a steady bitrate, which is
    /// close enough for MP3 to know when a seek can go ahead without waiting.
    fn bytes_needed(&self, stream: &Progressive, to: Duration) -> usize {
        let duration_ms = self
            .current
            .lock()
            .expect("player mutex")
            .as_ref()
            .map_or(0, |track| track.duration_ms);
        match stream.total() {
            Some(total) if duration_ms > 0 => {
                let fraction = (to.as_millis() as f64 / duration_ms as f64).min(1.0);
                (total as f64 * fraction) as usize + SEEK_MARGIN_BYTES
            }
            // No way to tell where the time lands: wait for the whole file.
            _ => usize::MAX,
        }
    }
}

/// The thread that carries out seeks into parts still downloading.
///
/// `Sink::try_seek` waits for the audio thread to do the seek, and the decoder
/// would wait there for bytes that have not arrived — holding up both the sound
/// and whoever asked. Here the wait happens first, on a thread of its own, and
/// the seek is issued once the data is in. Only the latest request counts.
fn spawn_seeker(sink: Arc<Sink>, generation: Arc<AtomicU64>) -> Result<mpsc::Sender<SeekJob>> {
    let (tx, rx) = mpsc::channel::<SeekJob>();
    std::thread::Builder::new()
        .name("ymsync-seek".to_string())
        .spawn(move || {
            while let Ok(mut job) = rx.recv() {
                while let Ok(newer) = rx.try_recv() {
                    job = newer;
                }
                let arrived = job.stream.wait_for(job.need_bytes, SEEK_WAIT);
                if job.generation != generation.load(Ordering::SeqCst) {
                    continue;
                }
                if arrived {
                    let _ = sink.try_seek(job.to);
                }
            }
        })
        .context("spawning the seek thread")?;
    Ok(tx)
}

impl Playback for Player {
    /// The in-memory buffer is what makes a seek cost a decoder reset instead of
    /// a network round trip.
    fn needs_bytes(&self) -> bool {
        true
    }

    fn plays_while_downloading(&self) -> bool {
        true
    }

    /// Decoding probes the container, so this blocks briefly — and, for a track
    /// still downloading, until its first part is in. The engine calls it from a
    /// blocking task.
    fn load(&self, track: TrackRef, source: AudioSource) -> Result<()> {
        let (decoder, stream): (Box<dyn Source<Item = f32> + Send>, _) = match source {
            AudioSource::Bytes(data) => {
                let len = data.len() as u64;
                let decoder = build_decoder(Cursor::new(data), Some(len))
                    .with_context(|| format!("decoding audio for {track}"))?;
                (Box::new(decoder), None)
            }
            AudioSource::Stream(stream) => {
                let decoder = build_decoder(stream.reader(), stream.total())
                    .with_context(|| format!("decoding audio for {track}"))?;
                (Box::new(decoder), Some(stream))
            }
            AudioSource::Url(_) | AudioSource::Named => {
                bail!("этот плеер играет из памяти или из загрузки, а не по ссылке")
            }
        };

        self.generation.fetch_add(1, Ordering::SeqCst);
        // `clear` drops the previous source and leaves the sink paused, so the
        // new track cannot start before we have positioned it.
        self.sink.clear();
        self.sink.append(decoder);
        // The position counter is not reset until the audio thread notices the
        // new source, so force it: otherwise the previous track's playhead is
        // briefly reported against the new track's duration.
        let _ = self.sink.try_seek(Duration::ZERO);
        *self.current.lock().expect("player mutex") = Some(track);
        *self.stream.lock().expect("player mutex") = stream;
        Ok(())
    }

    fn play(&self) {
        self.sink.play();
    }

    fn pause(&self) {
        self.sink.pause();
    }

    fn seek_ms(&self, ms: u64) -> Result<()> {
        let to = Duration::from_millis(ms);
        let pending = self
            .stream
            .lock()
            .expect("player mutex")
            .clone()
            .filter(|stream| !stream.is_done());

        if let Some(stream) = pending {
            let need_bytes = self.bytes_needed(&stream, to);
            if stream.len() < need_bytes {
                // Not downloaded that far yet: the seek thread waits for it, and
                // the caller — the sync loop — carries on meanwhile.
                let _ = self.seeker.send(SeekJob {
                    generation: self.generation.load(Ordering::SeqCst),
                    to,
                    stream,
                    need_bytes,
                });
                return Ok(());
            }
        }

        self.sink
            .try_seek(to)
            .map_err(|err| anyhow!("seeking to {ms} ms failed: {err}"))
    }

    fn position_ms(&self) -> u64 {
        self.sink.get_pos().as_millis() as u64
    }

    fn is_playing(&self) -> bool {
        !self.sink.is_paused() && !self.sink.empty()
    }

    fn is_finished(&self) -> bool {
        self.sink.empty()
    }

    fn current_track_id(&self) -> Option<String> {
        self.current
            .lock()
            .expect("player mutex")
            .as_ref()
            .map(|t| t.track_id.clone())
    }

    fn set_volume(&self, volume: f32) {
        self.sink.set_volume(volume.clamp(0.0, 2.0));
    }

    fn volume(&self) -> f32 {
        self.sink.volume()
    }
}

fn build_decoder<R>(data: R, byte_len: Option<u64>) -> Result<rodio::Decoder<R>>
where
    R: Read + Seek + Send + Sync + 'static,
{
    let mut builder = DecoderBuilder::new()
        .with_data(data)
        .with_seekable(true)
        .with_hint("mp3");
    // Without the byte length, MP3 seeking and duration are unreliable.
    if let Some(len) = byte_len {
        builder = builder.with_byte_len(len);
    }
    builder.build().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    /// A source of `n` distinct samples, so a test can tell which one it got.
    fn numbered(n: usize) -> rodio::buffer::SamplesBuffer {
        rodio::buffer::SamplesBuffer::new(1, 44_100, (1..=n).map(|i| i as f32).collect::<Vec<_>>())
    }

    /// The device can go away mid-song (Bluetooth headphones switched off) and a
    /// new output stream takes over. It must carry on from the very sample the
    /// old one stopped at, with the sink, its track and its position untouched.
    #[test]
    fn a_new_output_continues_where_the_old_one_stopped() {
        let (mixer, source) = rodio::mixer::mixer(1, 44_100);
        let output = SharedOutput::new(source);
        let sink = Sink::connect_new(&mixer);
        sink.append(numbered(10));

        let mut first = output.handle();
        // The sink's queue plays a little silence while it picks the track up.
        let heard: Vec<f32> = first.by_ref().take(10_000).skip_while(|s| *s == 0.0).take(4).collect();
        drop(first);
        let mut second = output.handle();
        let then: Vec<f32> = second.by_ref().take(3).collect();

        assert_eq!(heard, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(then, [5.0, 6.0, 7.0]);
    }

    /// A stand-in device stream that counts how many are open.
    struct FakeStream(Arc<std::sync::atomic::AtomicUsize>);

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    fn fake_device() -> (Arc<std::sync::atomic::AtomicUsize>, Arc<AtomicU64>, impl FnMut() -> Result<FakeStream, String> + Send + 'static) {
        let live = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let opened = Arc::new(AtomicU64::new(0));
        let (l, o) = (Arc::clone(&live), Arc::clone(&opened));
        let open = move || {
            l.fetch_add(1, Ordering::SeqCst);
            o.fetch_add(1, Ordering::SeqCst);
            Ok(FakeStream(Arc::clone(&l)))
        };
        (live, opened, open)
    }

    /// The phone makes a player for every room it joins. One left behind must
    /// not keep its device open — and reopen it whenever the route changes.
    #[test]
    fn a_closed_player_closes_its_output() {
        let (live, _opened, mut open) = fake_device();
        let first = open().unwrap();
        let (events_tx, events) = mpsc::channel();
        let worker = std::thread::spawn(move || keep_output(first, &events, open, Duration::ZERO, Duration::ZERO));
        events_tx.send(AudioEvent::Closed).unwrap();
        worker.join().unwrap();
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    /// A route change reports the loss more than once; one new stream replaces
    /// the old, never two playing side by side.
    #[test]
    fn a_lost_output_is_replaced_by_a_single_new_stream() {
        let (live, opened, mut open) = fake_device();
        let first = open().unwrap();
        let (events_tx, events) = mpsc::channel();
        events_tx.send(AudioEvent::Lost).unwrap();
        events_tx.send(AudioEvent::Lost).unwrap();
        let worker = std::thread::spawn(move || keep_output(first, &events, open, Duration::from_millis(50), Duration::ZERO));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while opened.load(Ordering::SeqCst) < 2 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(live.load(Ordering::SeqCst), 1);
        assert_eq!(opened.load(Ordering::SeqCst), 2);
        events_tx.send(AudioEvent::Closed).unwrap();
        worker.join().unwrap();
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    /// An output stream drops a source that ends. Between tracks the sink has
    /// nothing to play, and the output must stay attached through that.
    #[test]
    fn the_output_plays_silence_rather_than_ending_when_nothing_plays() {
        let (_mixer, source) = rodio::mixer::mixer(1, 44_100);
        let output = SharedOutput::new(source);
        let silence: Vec<f32> = output.handle().take(5).collect();
        assert_eq!(silence, [0.0; 5]);
    }

    /// The sync loop shares one player across tasks and blocking calls. If a
    /// future `rodio` release makes `Sink` non-shareable, fail here rather than
    /// at every call site.
    #[test]
    fn player_can_be_shared_across_threads() {
        assert_send_sync::<Player>();
    }

    /// A decoder must be buildable over a download that has only begun: that is
    /// what lets a track start before it is all here.
    #[test]
    fn a_decoder_opens_on_a_partial_download() {
        let frame = [&[0xFF, 0xFB, 0x10, 0xC4][..], &[0u8; 100][..]].concat();
        let stream = Progressive::new(Some((frame.len() * 400) as u64));
        for _ in 0..40 {
            stream.push(&frame);
        }
        let filler = stream.clone();
        let rest = std::thread::spawn(move || {
            for _ in 0..360 {
                filler.push(&frame);
            }
            filler.finish();
        });
        let decoder = build_decoder(stream.reader(), stream.total());
        rest.join().unwrap();
        assert!(decoder.is_ok(), "decoder failed: {:?}", decoder.err());
    }

    /// The point of it all: sound comes out while the file is still arriving.
    #[test]
    fn audio_decodes_before_the_download_finishes() {
        let frame = [&[0xFF, 0xFB, 0x10, 0xC4][..], &[0u8; 100][..]].concat();
        let total_frames = 400;
        let stream = Progressive::new(Some((frame.len() * total_frames) as u64));
        for _ in 0..40 {
            stream.push(&frame);
        }

        // The rest trickles in later, as from a slow connection.
        let filler = stream.clone();
        let late = frame.clone();
        let rest = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            for _ in 40..total_frames {
                filler.push(&late);
            }
            filler.finish();
        });

        let decoder = build_decoder(stream.reader(), stream.total()).expect("decoder");
        // About a quarter of a second of audio, all from the first part.
        let samples = decoder.take(44_100 / 4).count();
        let arrived = stream.len();
        rest.join().unwrap();

        assert_eq!(samples, 44_100 / 4);
        assert!(
            arrived < frame.len() * total_frames,
            "the download had already finished ({arrived} bytes) — nothing was proven"
        );
    }
}
