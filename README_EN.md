# Tesla Cam Viewer 🚗

A web-based viewer for Tesla dashcam footage. Browse Sentry Clips, Saved Clips, and Recent Clips with synchronized multi-camera playback — all in your browser. No server required.

🔗 **Live Demo: [turboturn.github.io/tesla-cam-viewer](https://turboturn.github.io/tesla-cam-viewer/)**

[中文版](README.md)

## Features

- **Drag & Drop TeslaCam folder** — select your TeslaCam USB drive folder and all events appear in the sidebar
- **6-camera synchronized playback** — front, back, left/right pillar, left/right repeater in a 2×3 grid
- **Flexible layouts** — switch between grid (2×3), dual, quad, and single-camera views
- **Multi-segment playback** — events with dozens of 1-minute clips play seamlessly as one video, with a unified progress bar and segment markers
- **Cross-segment seeking** — drag the timeline to any point across all segments
- **Screenshot with timestamps** — capture composite screenshots of all cameras with real-time timestamps
- **Video export** — record multi-camera composites to MP4 via Canvas + MediaRecorder
- **SEI telemetry decoder** — extract embedded speed, steering, GPS, autopilot state from Tesla's H.264 SEI metadata (`sei-telemetry.js`)
- **Keyboard shortcuts** — Space (play/pause), ← → (±5s seek)
- **Mobile responsive** — drawer sidebar for small screens
- **Dark theme** — easy on the eyes, inspired by Tesla's UI

## Screenshot

![Tesla Cam Viewer](screenshot.png)

## Quick Start

1. Clone or download this repository
2. Open `index.html` in your browser
3. Click **选择文件夹** and select your TeslaCam USB drive folder
4. Events appear in the sidebar — click any event to start viewing

Alternatively, serve with any HTTP server for mobile access:

```bash
python3 -m http.server 8080
```

Then open `http://your-ip:8080` on your phone.

## How It Works

Everything runs in the browser. No backend, no build step, no dependencies.

### File Parsing
The app reads the TeslaCam folder structure:
- `SentryClips/` — events grouped by subfolder (timestamped)
- `SavedClips/` — manually saved events
- `RecentClips/` — grouped by date (all clips from the same day merged into one event)

Each event contains 6 camera views per segment (`.mp4` files).

### Synchronized Playback
One camera (front) is the master clock. All other videos follow via `timeupdate` sync — if any video drifts more than 0.3s, it's snapped back to the master position.

### Multi-Segment Play
Segment durations are preloaded serially. A unified progress bar shows the total time across all segments with segment boundary markers. When one segment ends, the next is loaded and playback continues automatically.

### SEI Telemetry (Optional)
Tesla stores vehicle telemetry as protobuf-encoded metadata inside H.264 SEI NAL units. `sei-telemetry.js` provides a complete browser-side decoder:
- Speed (m/s → km/h)
- GPS coordinates (latitude/longitude)
- Accelerator pedal position, brake state
- Steering angle, turn signals
- Autopilot state (None/FSD/Autosteer/TACC)
- G-force (3-axis accelerometer)

To enable SEI telemetry overlay, add `<script src="sei-telemetry.js"></script>` to `index.html` and call `extractTelemetryFromMp4(file)`.

## Tech Stack

- **Frontend**: Single-file HTML/CSS/JavaScript — zero dependencies
- **Map**: Leaflet (CDN, for GPS visualization)
- **Car**: Tesla Model 3/Y dashcam format

## Browser Support

| Browser | Status |
|----------|--------|
| Chrome / Edge | Fully supported |
| Firefox | Supported |
| Safari | Supported (limited folder picker) |
| Mobile Safari / Chrome | Supported |

Requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) for the folder picker (Chrome/Edge). Falls back to individual file selection on other browsers.

## License

MIT
