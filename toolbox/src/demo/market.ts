// Static marketplace data and demo state types. Nothing here is real money
// or a real server: it is the product story, made visible.

export interface Listing {
  id: string;
  name: string;
  description: string;
  author: string;
  price: number;
  premium: boolean;
  rating: number;
  installs: string;
  color: string;
  category: string;
}

export interface IncomingShare {
  id: string;
  listingId: string;
  from: string;
  note: string;
  status: "pending" | "accepted" | "declined";
}

export interface OutgoingShare {
  id: string;
  listingId: string;
  to: string;
}

export const LISTINGS: Listing[] = [
  {
    id: "doc-qa",
    name: "Doc Q&A",
    description: "Ask questions across a folder of PDFs and get cited answers.",
    author: "alex",
    price: 19,
    premium: false,
    rating: 4.8,
    installs: "1.2k",
    color: "#E6F1FB",
    category: "Research",
  },
  {
    id: "meeting-summarizer",
    name: "Meeting Summarizer",
    description: "Turns a transcript into decisions and action items.",
    author: "priya",
    price: 0,
    premium: false,
    rating: 4.6,
    installs: "860",
    color: "#EAF3DE",
    category: "Meetings",
  },
  {
    id: "image-captioner",
    name: "Image Captioner",
    description: "Writes accessible alt text for a batch of images.",
    author: "sam",
    price: 12,
    premium: false,
    rating: 4.5,
    installs: "640",
    color: "#FAEEDA",
    category: "Media",
  },
  {
    id: "sql-explorer",
    name: "SQL Explorer",
    description: "Ask a database a question in plain English and see the query.",
    author: "datawizard",
    price: 29,
    premium: true,
    rating: 4.9,
    installs: "2.4k",
    color: "#E6F8F0",
    category: "Data",
  },
  {
    id: "resume-tailor",
    name: "Resume Tailor",
    description: "Matches your CV to a job description, line by line.",
    author: "kate",
    price: 9,
    premium: false,
    rating: 4.7,
    installs: "3.1k",
    color: "#F1E6F8",
    category: "Career",
  },
  {
    id: "logo-studio",
    name: "Logo Studio",
    description: "Generates logo variations from a short brief.",
    author: "mira",
    price: 24,
    premium: false,
    rating: 4.4,
    installs: "910",
    color: "#E6F1FB",
    category: "Design",
  },
  {
    id: "audio-cleaner",
    name: "Audio Cleaner",
    description: "Removes background noise from a recording.",
    author: "jules",
    price: 0,
    premium: false,
    rating: 4.3,
    installs: "1.8k",
    color: "#EAF3DE",
    category: "Audio",
  },
  {
    id: "prompt-vault",
    name: "Prompt Vault",
    description: "A shared, versioned library of your team's best prompts.",
    author: "ops",
    price: 0,
    premium: true,
    rating: 4.8,
    installs: "5.2k",
    color: "#FAEEDA",
    category: "Team",
  },
];

export const INCOMING: IncomingShare[] = [
  {
    id: "share-1",
    listingId: "doc-qa",
    from: "alex",
    note: "Thought this would help with the research folder.",
    status: "pending",
  },
];

export const REDEEM_CODES = ["GITRUN-PRO", "PREMIUM2026"];
