# Toolbox — All-in-one AI tools platform

A desktop application (Tauri + React) that packages open-source AI tools
into a clean, non-technical interface. No terminals. No installations. Just open and run.

## Architecture

```
toolbox/
├── src/                        # React frontend
│   ├── App.tsx                 # Root — wires sidebar + panel
│   ├── App.css                 # All styles
│   ├── store/
│   │   └── useToolStore.ts     # Zustand — tools, build status, output
│   └── components/
│       ├── Sidebar/
│       │   └── Sidebar.tsx     # Left column — tool list + marketplace
│       ├── ToolPanel/
│       │   └── ToolPanel.tsx   # Centre — header + routes to panel type
│       └── panels/
│           └── index.tsx       # Three panel types (file→text, url→file, file→files)
│
└── src-tauri/                  # Rust backend
    └── src/
        └── lib.rs              # Commands: list_tools, request_build, run_tool
```

## Three panel types

| Type | Example tool | Input | Output |
|---|---|---|---|
| `file_in_text_out` | Whisper | Audio/video file | Transcription text |
| `url_in_file_out` | yt-dlp | URL | Downloaded file |
| `file_in_files_out` | Demucs | Audio file | Multiple stem files |

Adding a new tool = add a row to the SQLite seed in `lib.rs` with the right `panel_type`.
The UI renders itself automatically.

## Setup

```bash
# Prerequisites: Rust, Node 20+, Tauri CLI
npm install
npm run tauri dev
```

## Environment variables

```
TOOLBOX_API_URL=https://api.toolbox.app   # Your build server URL
```

## Build flow (cloud, one-time per tool)

1. Frontend calls `request_build(tool_id, github_url)`
2. Rust backend submits to cloud build API (FastAPI + Docker)
3. Rust polls every 5s, emits `build:progress` events to frontend
4. On success, downloads `.exe` to `{app_data}/tools/{tool_id}.exe`
5. Emits `build:installed` → tool shows as ready in sidebar

## Adding a new tool to the marketplace

In `src-tauri/src/lib.rs`, add to `seed_marketplace()`:

```rust
(
    "tool-id",
    "Tool Name",
    "One sentence describing what it does for the user",
    "Category",                          // Audio, Video, Image, Text, Code, Data
    "https://github.com/org/repo",
    "#EAF3DE",                           // Icon background colour
    "file_in_text_out",                  // Panel type
),
```

That's it. The sidebar, install flow, and build pipeline handle everything else.
