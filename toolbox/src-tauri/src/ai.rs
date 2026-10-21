//! AI advisor: builds and repairs a `quickrun.yml` for a repository.
//!
//! Provider: OpenRouter is preferred (one key, DeepSeek models reachable
//! through it); a direct DeepSeek key still works as a fallback.
//!
//! This module never executes anything. It reads the repository that QuickRun
//! checked out, asks the model for a complete `quickrun.yml`, and returns it as
//! a proposal. Validation (`quickrun validate`) and running stay in
//! `quickrun.rs`, so QuickRun remains the only authority on what is valid and
//! what runs.

use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use crate::quickrun;

const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL: &str = "deepseek/deepseek-chat";
const DEEPSEEK_BASE: &str = "https://api.deepseek.com";
const DEEPSEEK_MODEL: &str = "deepseek-chat";
const TIMEOUT: Duration = Duration::from_secs(90);

/// Where the model is reached and with which key.
pub struct Provider {
    pub key: String,
    pub base: String,
    pub model: String,
    pub openrouter: bool,
}

/// What the model returns: a diagnosis, a confidence, and the YAML itself.
#[derive(Debug, Clone, Deserialize)]
pub struct Proposal {
    #[serde(default)]
    pub diagnosis: String,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub yaml: String,
}

fn env_or(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// Picks a provider: OpenRouter first (`OPENROUTER_API_KEY`), then direct
/// DeepSeek (`DEEPSEEK_API_KEY`). Base/model are overridable per provider.
pub fn resolve_provider(app: &AppHandle) -> Result<Provider, String> {
    if let Ok(key) = crate::resolve_openrouter_api_key(app) {
        return Ok(Provider {
            key,
            base: env_or("OPENROUTER_BASE_URL", OPENROUTER_BASE)
                .trim_end_matches('/')
                .to_string(),
            model: env_or("OPENROUTER_MODEL", OPENROUTER_MODEL),
            openrouter: true,
        });
    }

    if let Ok(key) = resolve_deepseek_key(app) {
        return Ok(Provider {
            key,
            base: env_or("DEEPSEEK_BASE_URL", DEEPSEEK_BASE)
                .trim_end_matches('/')
                .to_string(),
            model: env_or("DEEPSEEK_MODEL", DEEPSEEK_MODEL),
            openrouter: false,
        });
    }

    Err("No AI key: set OPENROUTER_API_KEY (preferred) or DEEPSEEK_API_KEY.".to_string())
}

fn resolve_deepseek_key(app: &AppHandle) -> Result<String, String> {
    if let Ok(key) = std::env::var("DEEPSEEK_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            let mut config = crate::load_config(app);
            if config.deepseek_api_key.as_deref() != Some(trimmed) {
                config.deepseek_api_key = Some(trimmed.to_string());
                let _ = crate::save_config(app, &config);
            }
            return Ok(trimmed.to_string());
        }
    }

    crate::load_config(app)
        .deepseek_api_key
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "DEEPSEEK_API_KEY is not set.".to_string())
}

/// Reads the repo evidence the model needs: README, manifests, and the tree.
fn evidence(workspace: &str) -> String {
    let root = Path::new(workspace);
    let mut out = String::new();

    let readme = ["README.md", "readme.md", "README.rst", "README.txt", "README"]
        .iter()
        .find_map(|name| fs::read_to_string(root.join(name)).ok());
    push_section(&mut out, "README", readme);

    for name in [
        "package.json",
        "Makefile",
        "makefile",
        "Taskfile.yml",
        "Taskfile.yaml",
        "justfile",
        "Justfile",
        "Procfile",
        ".replit",
        "pyproject.toml",
        "requirements.txt",
        "docker-compose.yml",
        "compose.yml",
        "Dockerfile",
    ] {
        if let Ok(text) = fs::read_to_string(root.join(name)) {
            push_section(&mut out, name, Some(text));
        }
    }

    let manifests: Vec<&str> = [
        "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "uv.lock", "poetry.lock",
        "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
        ".nvmrc", ".python-version", ".tool-versions", "docker-compose.yml", "compose.yml",
    ]
    .iter()
    .filter(|name| root.join(name).exists())
    .copied()
    .collect();
    out.push_str(&format!("\n### manifests present\n{}\n", manifests.join(", ")));

    if let Ok(entries) = fs::read_dir(root) {
        let mut names: Vec<String> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| !name.starts_with('.') || name == ".nvmrc" || name == ".python-version")
            .collect();
        names.sort();
        out.push_str(&format!("\n### top level\n{}\n", names.join(", ")));
    }

    out
}

fn push_section(out: &mut String, label: &str, text: Option<String>) {
    if let Some(text) = text {
        let truncated: String = text.chars().take(6000).collect();
        out.push_str(&format!("\n### {label}\n{truncated}\n"));
    }
}

fn tools_available() -> String {
    ["node", "npm", "pnpm", "yarn", "bun", "python3", "dotnet", "docker"]
        .iter()
        .filter(|tool| which(tool))
        .copied()
        .collect::<Vec<_>>()
        .join(", ")
}

fn which(name: &str) -> bool {
    std::process::Command::new("which")
        .arg(name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

const SYSTEM: &str = r#"You are QuickRun's configuration generator. QuickRun starts a repository by executing a quickrun.yml file.
Return ONLY a JSON object with exactly these keys: {"diagnosis": "one short sentence", "confidence": 0.0-1.0, "yaml": "<the complete quickrun.yml>"}.

The yaml must be a valid quickrun.yml, version 1. Schema (all blocks optional, but something must run):
  version: 1
  name, description, icon, docs
  requires: [ { tool: node, version: ">=20", install: "https://nodejs.org", optional: false } ]
  inputs: [ { id, label, type: text|password|number|bool|select|path|dir|file, default, required, env, options } ]
  env: { KEY: value }
  setup: [ { run: "npm install", cwd: "web", when: [windows|linux|macos], continueOnError: false } ]
  tasks: [ { name, run, cwd, env, dependsOn: [names], readyWhen: {port: 5173} | {http: "http://localhost:5173"} | {log: "regex"} | {window: true} | {delay: "5s"}, open: true, restart: never|onFailure } ]
  stop: [ { run: "..." } ]

Rules:
- Produce a quickrun.yml that runs the project. It can be a web app, a multi-service workflow, or a CLI tool.
- For a project with several components (database, API, frontend), give each its own task, order them with dependsOn, and give each a readyWhen; open the main user-facing URL.
- For a CLI tool, one task that runs it is enough; readyWhen is optional.
- Prefer the detected baseline when it is correct; change only what is wrong.
- Declare the package manager and runtime in requires (node, pnpm, yarn, dotnet, docker) so QuickRun can install them.
- For a web app, use the framework's real port and open: true.
- A build-then-run task (make, cargo, dotnet, swiftc) is not a server: give it a readyWhen (log regex, delay, or window) so "ready" means the app is up.
- Native desktop builds often need a signing identity; prefer a command that launches the app, or explain the problem in diagnosis.
- You may declare required inputs (API keys, database URLs, logins) in `inputs`; GitRun collects them before the run. Never put secrets in the generated yaml or in `env`.
- If the project cannot be run automatically, set confidence to 0 and explain in diagnosis; still return the best yaml you can."#;

fn chat(provider: &Provider, user: &str) -> Result<String, String> {
    match chat_once(provider, user, true) {
        Ok(text) => Ok(text),
        Err(error)
            if error.contains("response_format")
                || error.contains(" 400")
                || error.contains(" 422") =>
        {
            // Some routes reject JSON mode; the system prompt and extract_json
            // still get us a JSON object.
            chat_once(provider, user, false)
        }
        Err(error) => Err(error),
    }
}

fn chat_once(provider: &Provider, user: &str, json_mode: bool) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let mut body = serde_json::json!({
        "model": provider.model,
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": user }
        ],
        "temperature": 0,
        "max_tokens": 2500
    });
    if json_mode {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    let mut request = client
        .post(format!("{}/chat/completions", provider.base))
        .timeout(TIMEOUT)
        .header("Authorization", format!("Bearer {}", provider.key))
        .json(&body);

    if provider.openrouter {
        request = request
            .header("HTTP-Referer", "https://gitrun.app")
            .header("X-Title", "GitRun");
    }

    let response = request.send().map_err(|e| format!("AI request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().unwrap_or_default();
        return Err(format!(
            "AI returned {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }

    let data: serde_json::Value = response
        .json()
        .map_err(|e| format!("AI response unreadable: {e}"))?;

    data.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .map(|text| text.to_string())
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "AI returned an empty response.".to_string())
}

fn research_section(research: Option<&crate::tinyfish::Research>) -> String {
    match research {
        Some(research) => {
            let structured = serde_json::to_string_pretty(&research.value)
                .unwrap_or_else(|_| research.value.to_string());
            let truncated: String = structured.chars().take(5000).collect();
            let sources = if research.sources.is_empty() {
                String::new()
            } else {
                format!("\nSources: {}", research.sources.join(", "))
            };
            format!("\n\nTinyFish web research (from the repository's docs/issues):\n{truncated}{sources}\n")
        }
        None => String::new(),
    }
}

/// Asks for a hardened config for a repository QuickRun already checked out.
pub fn generate(
    provider: &Provider,
    repo: &str,
    workspace: &str,
    detected: &str,
    research: Option<&crate::tinyfish::Research>,
) -> Result<Proposal, String> {
    let user = format!(
        "Repository: {repo}\n\nDetected baseline quickrun.yml:\n{detected}\n\nRepository evidence:\n{}{}\n\nTools available on this machine: {}\n",
        evidence(workspace),
        research_section(research),
        tools_available()
    );
    parse_proposal(&chat(provider, &user)?)
}

/// Asks for a corrected config after a failed run.
pub fn repair(
    provider: &Provider,
    repo: &str,
    workspace: &str,
    failed_config: &str,
    failure: &str,
    last_output: &str,
    fix_research: Option<&crate::tinyfish::Research>,
) -> Result<Proposal, String> {
    let user = format!(
        "Repository: {repo}\n\nThe current quickrun.yml FAILED:\n{failed_config}\n\nFailure:\n{failure}\n\nRecent output:\n{last_output}\n\nRepository evidence:\n{}{}\n\nTools available on this machine: {}\n\nProduce a corrected quickrun.yml that fixes this failure.\n",
        evidence(workspace),
        research_section(fix_research),
        tools_available()
    );
    parse_proposal(&chat(provider, &user)?)
}

fn parse_proposal(text: &str) -> Result<Proposal, String> {
    let json = extract_json(text).ok_or_else(|| "the model did not return a JSON object".to_string())?;

    let diagnosis = json
        .get("diagnosis")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let confidence = json
        .get("confidence")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.5);
    let yaml = json
        .get("yaml")
        .or_else(|| json.get("config"))
        .or_else(|| json.get("quickrun_yaml"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();

    if yaml.trim().is_empty() {
        return Err("the model returned no yaml".to_string());
    }

    Ok(Proposal {
        diagnosis,
        confidence,
        yaml,
    })
}

fn extract_json(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(value);
    }

    // Strip a ```json ... ``` fence if the model added one.
    let unfenced = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(|rest| rest.trim_start())
        .unwrap_or(trimmed);
    let unfenced = unfenced
        .strip_suffix("```")
        .map(|rest| rest.trim_end())
        .unwrap_or(unfenced);

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(unfenced) {
        return Some(value);
    }

    let start = unfenced.find('{')?;
    let end = unfenced.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(&unfenced[start..=end]).ok()
}

/// Writes the proposal as QuickRun's override for this repository.
pub fn commit(repo: &str, yaml: &str) -> Result<(), String> {
    quickrun::write_override(repo, yaml)
}
