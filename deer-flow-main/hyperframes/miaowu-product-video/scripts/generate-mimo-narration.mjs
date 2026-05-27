import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, "script.txt");
const outputPath = path.join(projectRoot, "assets", "narration-mimo-default.mp3");
const localEnvPath = path.join(projectRoot, ".mimo-tts.local.env");

async function loadLocalEnv(filePath) {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [rawKey, ...rawValueParts] = trimmed.split("=");
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

await loadLocalEnv(localEnvPath);

const baseUrl = (
  process.env.MIMO_TTS_BASE_URL ||
  process.env.MIMO_BASE_URL ||
  process.env.MIMO_API_BASE ||
  ""
).trim().replace(/\/$/, "");

const apiKey = (
  process.env.MIMO_TTS_API_KEY ||
  process.env.MIMO_API_KEY ||
  ""
).trim();

const model = (process.env.MIMO_TTS_MODEL || "mimo-v2.5-tts").trim();
const voice = (process.env.MIMO_TTS_VOICE || "mimo_default").trim();
const format = (process.env.MIMO_TTS_FORMAT || "mp3").trim();
const authHeader = (process.env.MIMO_TTS_AUTH_HEADER || "authorization").trim().toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function endpointFromBase(value) {
  if (!value) {
    return "";
  }
  const normalized = value.endsWith("/v1") ? value : `${value}/v1`;
  return `${normalized}/chat/completions`;
}

function extractAudioBase64(data) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  for (const choice of choices) {
    const message = choice?.message;
    const candidates = [
      message?.audio?.data,
      message?.audio?.audio,
      message?.audio?.b64_json,
      message?.audio?.base64,
      choice?.audio?.data,
      choice?.audio?.audio,
      choice?.audio?.b64_json,
      choice?.audio?.base64,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return null;
}

if (!baseUrl) {
  fail("MIMO_TTS_BASE_URL is required. Example: $env:MIMO_TTS_BASE_URL='https://your-newapi.example/v1'");
}

if (!apiKey) {
  fail("MIMO_TTS_API_KEY is required. Set it in the current shell; this script does not read or store secrets.");
}

const text = (await readFile(scriptPath, "utf8")).trim();
if (!text) {
  fail("script.txt is empty.");
}

const payload = {
  model,
  modalities: ["text", "audio"],
  audio: {
    voice,
    format,
  },
  messages: [
    {
      role: "assistant",
      content: text,
    },
  ],
};

const endpoint = endpointFromBase(baseUrl);
const headers = {
  "content-type": "application/json",
};
if (authHeader === "api-key") {
  headers["api-key"] = apiKey;
} else {
  headers.Authorization = `Bearer ${apiKey}`;
}

const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

const responseText = await response.text();
if (!response.ok) {
  fail(`MiMo TTS request failed: HTTP ${response.status} ${response.statusText}\n${responseText.slice(0, 800)}`);
}

let data;
try {
  data = JSON.parse(responseText);
} catch {
  fail(`MiMo TTS returned non-JSON content:\n${responseText.slice(0, 800)}`);
}

const audioBase64 = extractAudioBase64(data);
if (!audioBase64) {
  fail(`MiMo TTS response did not contain audio data. Keys: ${Object.keys(data).join(", ")}`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(audioBase64, "base64"));
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
