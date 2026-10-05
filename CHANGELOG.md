# Changelog

## v0.0.2

- Multi-camera selection and up to 16 independent recorded streams.
- Shared and individual playback controls, with a common playback clock and buffering barrier.
- Manual correction for footage returned before the requested recording time.
- Batch exports, a two-export concurrency limit, queued jobs, and independent cancellation.
- Thumbnail previews disabled pending rework.
- Fixed garbled interface text, UTF-8 asset headers, and editor encoding configuration.
- Regression checks for stream isolation, cancellation, synchronization, and player alignment.
- Known limitation: automatic alignment to original recording timestamps is not yet available.

## v0.0.1

- Initial local web UI for compatible CP Plus recorded RTSP playback.
- Dynamic camera discovery through HTTP Digest or HTTPS RPC2.
- Original-video export with MP4 validation and cancellation.
- H.265 browser preview through a bundled go2rtc build.
- Speed selection through 8× and jump controls.
- Stable clip timeline and pause-preserving seeking.
- Replay frame-timing fix for sparse frames at faster speeds.
