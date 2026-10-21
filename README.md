# GitRun

**Paste a GitHub URL, get a running web app.**

GitRun is a desktop app that figures out how to run an open-source repository and starts it for
you — no terminal, no dependency hunting, no reading setup docs.

---

## How it works

```
GitHub URL
   │
   ▼
QuickRun  ───────────  checks the repo out, detects how it starts
   │
   ▼
TinyFish  ───────────  browser agent: reads the rendered docs, issues and
   │                   discussions, returns structured setup findings
   ▼
DeepSeek  ───────────  writes a quickrun.yml from the repo files + that research
   │
   ▼
quickrun validate  ──  QuickRun's real validator; nothing runs until it passes
   │
   ▼
QuickRun  ───────────  installs prerequisites, starts the app, streams logs,
   │                   detects readiness, opens the URL, supervises, stops
   ▼
auto-repair  ────────  on failure: TinyFish searches for the fix, DeepSeek
                       rewrites the config, validate, run again (max 2)
```

Three pieces, three jobs:

- **QuickRun** (C# / .NET) is the **execution engine** — checkout, project detection, execution
  planning, dependency provisioning, process supervision, readiness detection, logs, stop.
- **TinyFish** is the **research agent** — a cloud browser that reads documentation and issue
  threads the way a person would, and returns structured JSON with source URLs.
- **DeepSeek** (via OpenRouter) is the **config writer** — turns the repository files plus
  TinyFish's findings into a valid `quickrun.yml`.

Nothing is executed until the generated config passes QuickRun's validator.

## TinyFish integration

TinyFish is a first-class step in the pipeline, not a badge:

1. **Before a run**, GitRun calls `POST https://agent.tinyfish.ai/v1/automation/run` with the
   repository URL, a plain-English goal ("read the README, rendered docs, issues and discussions;
   determine exactly how to run it") and an `output_schema`. The agent browses the pages and
   returns structured fields — `package_manager`, `install_command`, `start_command`, `port`,
   `env_vars`, `notes` — together with the source URLs it used.
2. **On failure**, GitRun calls the same endpoint with the failure text and a goal to find a known
   cause and fix in issues / Stack Overflow, and feeds that into the repair prompt.

The findings are passed to the config writer as evidence. TinyFish never writes or runs a config
itself; QuickRun remains the only thing that validates and executes. If `TINYFISH_API_KEY` is
absent, GitRun skips research and falls back to local files only.

## Setup

Prerequisites: Node 20+, Rust, the .NET 10 SDK (to build QuickRun), and whatever the target repo
needs (Node / Python / Docker).

```bash
# 1. Build QuickRun as a self-contained single file
git clone https://github.com/fgilde/QuickRun
cd QuickRun
dotnet publish src/QuickRun.App -c Release -r osx-arm64 -o out

# 2. Keys
export OPENROUTER_API_KEY=sk-or-...   # or DEEPSEEK_API_KEY=...
export TINYFISH_API_KEY=...
export QUICKRUN_BIN="$PWD/out/quickrun"

# 3. Run GitRun
cd toolbox
npm install
npm run tauri dev
```

Keys can also be pasted in **Settings** (the gear in the sidebar); they are stored in the app's
config file on this machine, not in the repository.

Then click **"Run a repository"**, paste a public GitHub URL, and watch the status go
`researching → analyzing → starting → running`. The app's URL appears when it is ready. It is saved
under **Recent** for next time; **Rebuild** regenerates the config with the AI.

## Private repos and sharing (team preview)

- **Private repos:** paste the repo URL and an **access token**. The token is used only to
  authenticate the checkout; it is never sent to the AI or TinyFish, and it is redacted from the
  logs before they reach the UI.
- **Share links:** while a repo is running, **Share** copies a `gitrun://run?repo=…` link. Paste
  that link into the URL field (on this machine or a colleague's) to run the same app. Tokens are
  never put into a link — each person supplies their own if the repo is private.

## Before it runs (review & provide)

If a project needs values (an API key, a database URL), GitRun pauses on a **review screen** before
anything starts. It shows what will run, what the docs say (TinyFish), and a form for the values.
Pressing **Run** supplies them to the run as environment variables; they are never logged or sent to
the AI.

## Collections (demo, static)

GitRun shows a **Featured apps** catalogue by default — WisprFlow, Grammarly, Otter.ai, Descript,
Notion AI, Perplexity, Figma, Canva, Zapier, n8n, Ollama, ComfyUI, Whisper, yt-dlp, Immich,
Jellyfin — grouped by category. It is a static demo: entries are shown, not executed.

It can also import a **collection** from a `gitrun://collection` link (also static):

- `gitrun://collection?id=ai-starter-pack` — AI Starter Pack (6 tools)
- `gitrun://collection?id=media-kit` — Creator Media Kit (4 tools)
- `gitrun://collection?id=ops-toolkit` — Ops Toolkit (3 tools)

Paste one into **"Import a collection"** (or into "Run a repository"), and the tools appear under
**Collections** in the sidebar. Clicking a tool shows its detail; running is disabled in this build.

**Discover tools** reads a public list/page with TinyFish and adds the tools it finds as a
collection. Imported and discovered collections are saved on the machine, so they survive a restart.

## Demo flow

1. Paste a Vite / Next / Streamlit / FastAPI repository URL.
2. Watch TinyFish research the repository (status banner).
3. Watch the app start, then open it **inside GitRun** (its own window) or in the browser. **How to
   use** asks TinyFish for a short runbook.
4. Multi-service repos show each task as it comes up: `db: ready · api: starting · web: ready`.
5. Close and reopen the app — the repo is in **Recent** and starts without rebuilding.
6. (Optional) Submit a repo that needs a tweak, or stop a run.

## Project layout

```
toolbox/                  the GitRun desktop app (Tauri 2 · Rust · React)
  src/                    UI — QuickRun view, sidebar, store
  src-tauri/src/
    quickrun.rs           QuickRun daemon client + the autorun/repair loop
    ai.rs                 config writer (OpenRouter / DeepSeek)
    tinyfish.rs           TinyFish research agent
    repos.rs              saved repositories + their configs
build-server/             legacy Python packaging pipeline (deferred; not on the demo path)
_previous_attempt/        earlier scaffold (unused)
```

## Scope and safety

- **Runs what QuickRun can:** web apps, multi-service workflows (database + API + frontend, with
  `dependsOn` and per-task readiness), and CLI tools. Native desktop builds are attempted; they may
  fail without a code-signing identity.
- **Python fallback:** if QuickRun finds nothing to run but the repo has a `requirements.txt` (or
  `pyproject.toml`) and a root `.py`, GitRun writes a plain Python recipe itself and retries.
- Repository code runs with your privileges; GitRun shows what is happening and keeps a **Stop**
  button. There is no sandbox.
- Generated configs are saved per repository and reused; use **Rebuild** to regenerate one.
- QuickRun is MIT-licensed (© Florian Gilde); its source and licence live in its own repository.

## Credits

- [QuickRun](https://github.com/fgilde/QuickRun) — execution engine (MIT)
- [TinyFish](https://docs.tinyfish.ai) — browser research agent
- OpenRouter / DeepSeek — config generation
