//! TinyFish research agent.
//!
//! TinyFish is a cloud browser agent: give it a URL and a plain-English goal,
//! and it browses the page like a person and returns structured JSON. GitRun
//! uses it for the two things a browser does better than reading local files:
//!
//!   1. researching a repository's rendered docs / issues before a run
//!   2. searching the web for the fix when a run fails
//!
//! The result is evidence handed to the config generator (`ai.rs`); TinyFish
//! never writes or runs a config itself.

use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

const ENDPOINT: &str = "https://agent.tinyfish.ai/v1/automation/run";
const TIMEOUT: Duration = Duration::from_secs(300);

/// What the browser agent found, plus where it found it.
#[derive(Debug, Clone)]
pub struct Research {
    /// The structured object the agent returned (fed to the config generator).
    pub value: Value,
    pub summary: String,
    pub sources: Vec<String>,
}

/// The TinyFish key: `TINYFISH_API_KEY`, or `tinyfish_api_key` in config.json.
pub fn resolve_key(app: &AppHandle) -> Result<String, String> {
    if let Ok(key) = std::env::var("TINYFISH_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            let mut config = crate::load_config(app);
            if config.tinyfish_api_key.as_deref() != Some(trimmed) {
                config.tinyfish_api_key = Some(trimmed.to_string());
                let _ = crate::save_config(app, &config);
            }
            return Ok(trimmed.to_string());
        }
    }

    crate::load_config(app)
        .tinyfish_api_key
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "TINYFISH_API_KEY is not set.".to_string())
}

/// One browser-agent run: visit `url`, pursue `goal`, return structured JSON.
fn run(key: &str, url: &str, goal: &str, schema: &Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::new();
    let body = serde_json::json!({
        "url": url,
        "goal": goal,
        "browser_profile": "lite",
        "capture_config": {
            "screenshots": true
        },
        "output_schema": schema
    });

    let response = client
        .post(ENDPOINT)
        .timeout(TIMEOUT)
        .header("X-API-Key", key)
        .json(&body)
        .send()
        .map_err(|e| format!("TinyFish request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().unwrap_or_default();
        return Err(format!(
            "TinyFish returned {status}: {}",
            text.chars().take(400).collect::<String>()
        ));
    }

    response
        .json::<Value>()
        .map_err(|e| format!("TinyFish response unreadable: {e}"))
}

/// Recursively finds the first object containing one of `keys`, so the parser
/// does not depend on the exact wrapper field of the run response.
fn find_object_with(value: &Value, keys: &[&str]) -> Option<Value> {
    match value {
        Value::Object(map) => {
            if keys.iter().any(|key| map.contains_key(*key)) {
                return Some(value.clone());
            }
            for child in map.values() {
                if let Some(found) = find_object_with(child, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_object_with(item, keys)),
        _ => None,
    }
}

fn strings(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn to_research(response: Value, summary_key: &str) -> Research {
    let keys = [summary_key, "start_command", "package_manager", "diagnosis", "fix"];
    let structured = find_object_with(&response, &keys).unwrap_or(response);
    let summary = text(&structured, summary_key);
    let sources = strings(&structured, "sources");

    Research {
        value: structured,
        summary,
        sources,
    }
}

/// Researches a repository's docs/issues for how to run it.
pub fn research_repo(key: &str, repo: &str) -> Result<Research, String> {
    let goal = "Read this repository's README and, if present, its rendered documentation site, \
        issues and discussions. Determine exactly how to run it as a web application: the package \
        manager, the install command, the start command, the port it listens on, required \
        environment variables, and any known setup problems. Prefer official sources and include \
        the URLs you used.";

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "package_manager": { "type": "string" },
            "install_command": { "type": "string" },
            "start_command": { "type": "string" },
            "port": { "type": "number" },
            "env_vars": { "type": "array", "items": { "type": "string" } },
            "notes": { "type": "array", "items": { "type": "string" } },
            "sources": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["summary"]
    });

    let response = run(key, repo, goal, &schema)?;
    Ok(to_research(response, "summary"))
}

/// Searches the web for a known cause/fix for a failed run.
pub fn research_fix(key: &str, repo: &str, error: &str) -> Result<Research, String> {
    let goal = format!(
        "This repository failed to run with the following error:\n\n{error}\n\n\
         Search the web for this repository plus the error. Open the most relevant GitHub issue or \
         Stack Overflow answer and return the likely cause, a concrete fix that can be expressed in \
         a run configuration, and the source URLs you used."
    );

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "diagnosis": { "type": "string" },
            "fix": { "type": "string" },
            "sources": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["diagnosis"]
    });

    let response = run(key, repo, &goal, &schema)?;
    Ok(to_research(response, "diagnosis"))
}

/// A short, non-technical runbook for using an app.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Runbook {
    pub summary: String,
    pub steps: Vec<String>,
    pub needs: Vec<String>,
    pub done_when: String,
    pub sources: Vec<String>,
}

/// Reads a repository's docs and writes a "how to use this" runbook.
pub fn research_runbook(key: &str, repo: &str) -> Result<Runbook, String> {
    let goal = "Write a short, numbered runbook for using this application as a non-technical person. \
        Start with what to open, then the first three actions to take, any value or key it needs, and \
        how the user can tell the task worked. Use the repository's README and documentation.";

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "steps": { "type": "array", "items": { "type": "string" } },
            "needs": { "type": "array", "items": { "type": "string" } },
            "done_when": { "type": "string" },
            "sources": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["steps"]
    });

    let response = run(key, repo, goal, &schema)?;
    let structured = find_object_with(&response, &["steps"]).unwrap_or(response);

    Ok(Runbook {
        summary: text(&structured, "summary"),
        steps: strings(&structured, "steps"),
        needs: strings(&structured, "needs"),
        done_when: text(&structured, "done_when"),
        sources: strings(&structured, "sources"),
    })
}

/// A tool found on a public list/page.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiscoveredTool {
    pub name: String,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Reads a public list/page and extracts the tools it mentions.
pub fn discover_tools(key: &str, list_url: &str) -> Result<Vec<DiscoveredTool>, String> {
    let goal = "List the tools, apps or projects mentioned on this page. For each one return its \
        name, the GitHub repository URL if the page links to one, and a one-line description. Only \
        include real entries from the page; do not invent tools.";

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "tools": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "repo": { "type": "string" },
                        "description": { "type": "string" }
                    },
                    "required": ["name"]
                }
            }
        },
        "required": ["tools"]
    });

    let response = run(key, list_url, goal, &schema)?;
    let structured = find_object_with(&response, &["tools"]).unwrap_or(response);
    let tools = structured
        .get("tools")
        .and_then(|value| serde_json::from_value::<Vec<DiscoveredTool>>(value.clone()).ok())
        .unwrap_or_default();

    Ok(tools)
}
