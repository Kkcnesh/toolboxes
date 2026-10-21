import { DemoCollection } from "../types";

// Fictional, static catalogues used by the "import a collection" demo feature.
// They are never fetched and their tools are never executed.

const AI_STARTER: DemoCollection = {
  id: "ai-starter-pack",
  name: "AI Starter Pack",
  description: "Six small AI tools a team can run without setup.",
  tools: [
    { id: "meeting-summarizer", name: "Meeting Summarizer", category: "Text", color: "#E6F1FB", description: "Turns a transcript into decisions and action items." },
    { id: "doc-qa", name: "Doc Q&A", category: "Text", color: "#EAF3DE", description: "Ask questions over a folder of PDFs." },
    { id: "image-captioner", name: "Image Captioner", category: "Image", color: "#FAEEDA", description: "Writes alt text for a batch of images." },
    { id: "voice-transcriber", name: "Voice Transcriber", category: "Audio", color: "#F1E6F8", description: "Speech to text with speaker labels." },
    { id: "prompt-playground", name: "Prompt Playground", category: "Code", color: "#E6F8F0", description: "Compare prompts side by side." },
    { id: "csv-cleaner", name: "CSV Cleaner", category: "Data", color: "#EAF3DE", description: "Dedupe, normalize and profile a spreadsheet." },
  ],
};

const MEDIA_KIT: DemoCollection = {
  id: "media-kit",
  name: "Creator Media Kit",
  description: "Clip, caption and clean up media in one place.",
  tools: [
    { id: "video-clipper", name: "Video Clipper", category: "Video", color: "#E6F1FB", description: "Cut highlights out of long recordings." },
    { id: "subtitle-burner", name: "Subtitle Burner", category: "Video", color: "#FAEEDA", description: "Burns captions into a video file." },
    { id: "thumbnail-studio", name: "Thumbnail Studio", category: "Image", color: "#F1E6F8", description: "Generates thumbnail variations from a frame." },
    { id: "audio-cleaner", name: "Audio Cleaner", category: "Audio", color: "#E6F8F0", description: "Removes background noise from a recording." },
  ],
};

const OPS_TOOLKIT: DemoCollection = {
  id: "ops-toolkit",
  name: "Ops Toolkit",
  description: "Small tools for on-call and incident work.",
  tools: [
    { id: "log-triage", name: "Log Triage", category: "Data", color: "#E6F1FB", description: "Groups a noisy log into likely causes." },
    { id: "incident-summarizer", name: "Incident Summarizer", category: "Text", color: "#FAEEDA", description: "Turns an incident thread into a timeline." },
    { id: "uptime-dashboard", name: "Uptime Dashboard", category: "Web", color: "#EAF3DE", description: "A one-page status board for your services." },
  ],
};

export const DEMO_COLLECTIONS: Record<string, DemoCollection> = {
  [AI_STARTER.id]: AI_STARTER,
  [MEDIA_KIT.id]: MEDIA_KIT,
  [OPS_TOOLKIT.id]: OPS_TOOLKIT,
};

/** Always shown in the app; the demo "store front". */
export const DEFAULT_COLLECTION: DemoCollection = {
  id: "featured",
  name: "Featured apps",
  description: "Well-known tools people want to run without setup.",
  tools: [
    { id: "wisprflow", name: "WisprFlow", category: "Audio", color: "#E6F1FB", tag: "Service", description: "Voice dictation that turns speech into clean, formatted text." },
    { id: "grammarly", name: "Grammarly", category: "Text", color: "#EAF3DE", tag: "Service", description: "Writing assistant for grammar, tone and clarity." },
    { id: "otter", name: "Otter.ai", category: "Audio", color: "#FAEEDA", tag: "Service", description: "Meeting transcription with summaries and action items." },
    { id: "descript", name: "Descript", category: "Video", color: "#F1E6F8", tag: "Service", description: "Edit audio and video by editing the transcript." },
    { id: "notion-ai", name: "Notion AI", category: "Text", color: "#E6F8F0", tag: "Service", description: "Writing, summarizing and Q&A inside your notes." },
    { id: "perplexity", name: "Perplexity", category: "Web", color: "#E6F1FB", tag: "Service", description: "AI search with cited answers." },
    { id: "figma", name: "Figma", category: "Design", color: "#FAEEDA", tag: "Service", description: "Collaborative interface design in the browser." },
    { id: "canva", name: "Canva", category: "Design", color: "#F1E6F8", tag: "Service", description: "Templates and design for people who aren't designers." },
    { id: "zapier", name: "Zapier", category: "Automation", color: "#E6F8F0", tag: "Service", description: "Connect apps and automate repetitive workflows." },
    { id: "n8n", name: "n8n", category: "Automation", color: "#E6F1FB", tag: "Open source", description: "Self-hosted workflow automation." },
    { id: "ollama", name: "Ollama", category: "AI", color: "#EAF3DE", tag: "Open source", description: "Run open models locally with one command." },
    { id: "comfyui", name: "ComfyUI", category: "Image", color: "#FAEEDA", tag: "Open source", description: "Node-based image generation workflows." },
    { id: "whisper", name: "Whisper", category: "Audio", color: "#F1E6F8", tag: "Open source", description: "Open-source speech transcription." },
    { id: "yt-dlp", name: "yt-dlp", category: "Video", color: "#E6F8F0", tag: "Open source", description: "Download video from the web, reliably." },
    { id: "immich", name: "Immich", category: "Media", color: "#E6F1FB", tag: "Open source", description: "Self-hosted photo and video backup." },
    { id: "jellyfin", name: "Jellyfin", category: "Media", color: "#EAF3DE", tag: "Open source", description: "Your own media server." },
  ],
};

/** Reads `gitrun://collection?id=<id>` (or `gitrun://collection/<id>`). */
export function parseCollectionLink(input: string): string | null {
  const text = input.trim();
  if (!text.startsWith("gitrun://")) return null;

  try {
    const url = new URL(text);
    if (url.hostname !== "collection") return null;

    const fromQuery = url.searchParams.get("id");
    if (fromQuery) return fromQuery;

    const fromPath = url.pathname.replace(/^\/+/, "");
    return fromPath || null;
  } catch {
    return null;
  }
}

export function demoCollectionLink(id: string): string {
  return `gitrun://collection?id=${encodeURIComponent(id)}`;
}
