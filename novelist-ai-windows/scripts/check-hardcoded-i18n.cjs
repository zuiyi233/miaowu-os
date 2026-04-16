#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();

const TARGET_PATHS = [
  "components/SettingsDialog.tsx",
  "components/chat/ChatInterface.tsx",
  "components/NovelForm.tsx",
  "components/NovelCreationDialog.tsx",
  "components/ChapterForm.tsx",
  "components/ChapterCreationDialog.tsx",
  "components/CharacterForm.tsx",
  "components/CharacterCreationDialog.tsx",
  "components/CharacterEditForm.tsx",
  "components/CharacterEditDialog.tsx",
  "components/CharacterDeleteDialog.tsx",
  "components/FactionForm.tsx",
  "components/FactionEditForm.tsx",
  "components/FactionDeleteDialog.tsx",
  "components/ItemForm.tsx",
  "components/ItemEditForm.tsx",
  "components/ItemEditDialog.tsx",
  "components/ItemDeleteDialog.tsx",
];

const IGNORE_TEXT_EXACT = new Set([
  "AI",
  "RAG",
  "JSON",
  "URL",
  "ID",
  "API",
  "DB",
  "OK",
  "none",
]);

const ATTR_NAMES = [
  "title",
  "description",
  "label",
  "placeholder",
  "loadingText",
  "confirmText",
  "cancelText",
  "aria-label",
  "alt",
];

const CHINESE_RE = /[\u4e00-\u9fff]/;
const ENGLISH_RE = /[A-Za-z]/;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function shouldFlagText(raw) {
  const text = raw.trim();
  if (!text) return false;
  if (IGNORE_TEXT_EXACT.has(text)) return false;

  if (/^\d+[A-Za-z%]*$/.test(text)) return false;
  if (/^[{}()[\].,:;!?+\-/*\\|"'`~<>@#$%^&=_\s]+$/.test(text)) return false;

  if (CHINESE_RE.test(text)) return true;

  if (!ENGLISH_RE.test(text)) return false;

  // Skip obvious non-UI tokens.
  if (/^(https?:\/\/|\.?\/?[\w./-]+)$/.test(text)) return false;
  if (/^[A-Za-z0-9_-]+$/.test(text) && text.length <= 3) return false;

  // Flag plain English text nodes/labels.
  return true;
}

function addViolation(violations, file, lineNo, kind, text) {
  violations.push({
    file,
    line: lineNo,
    kind,
    text: text.trim().slice(0, 120),
  });
}

function scanFile(absPath) {
  const relPath = path.relative(PROJECT_ROOT, absPath).replace(/\\/g, "/");
  const raw = fs.readFileSync(absPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const violations = [];

  let inBlockComment = false;

  const attrPattern = new RegExp(
    `\\b(?:${ATTR_NAMES.map((n) => n.replace("-", "\\-")).join("|")})\\s*=\\s*(["'])([^"']+)\\1`,
    "g"
  );
  const objectPattern = new RegExp(
    `\\b(?:${ATTR_NAMES.join("|")})\\s*:\\s*(["'])([^"']+)\\1`,
    "g"
  );
  const defaultParamPattern = new RegExp(
    `\\b(?:${ATTR_NAMES.join("|")})\\s*=\\s*(["'])([^"']+)\\1`,
    "g"
  );
  const toastPattern = /\btoast\.(?:success|error|info|warning)\s*\(\s*(["'])([^"']+)\1/g;
  const jsxTextPattern = />\s*([^<>{}][^<{}]*?)\s*</g;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    let line = lines[i];

    if (line.includes("i18n-scan-ignore")) continue;

    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (line.includes("/*")) {
      if (!line.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("//")) continue;

    let match;

    while ((match = attrPattern.exec(line)) !== null) {
      const text = match[2];
      if (shouldFlagText(text) && !/\bt\(/.test(line)) {
        addViolation(violations, relPath, lineNo, "jsx-attr", text);
      }
    }

    while ((match = objectPattern.exec(line)) !== null) {
      const text = match[2];
      if (shouldFlagText(text) && !/\bt\(/.test(line)) {
        addViolation(violations, relPath, lineNo, "object-literal", text);
      }
    }

    while ((match = defaultParamPattern.exec(line)) !== null) {
      const text = match[2];
      if (shouldFlagText(text) && !/\bt\(/.test(line)) {
        addViolation(violations, relPath, lineNo, "default-param", text);
      }
    }

    while ((match = toastPattern.exec(line)) !== null) {
      const text = match[2];
      if (shouldFlagText(text) && !/\bt\(/.test(line)) {
        addViolation(violations, relPath, lineNo, "toast", text);
      }
    }

    while ((match = jsxTextPattern.exec(line)) !== null) {
      const text = match[1];
      if (shouldFlagText(text) && !/\bt\(/.test(line)) {
        addViolation(violations, relPath, lineNo, "jsx-text", text);
      }
    }
  }

  return violations;
}

function main() {
  const files = TARGET_PATHS.map((p) => path.join(PROJECT_ROOT, p)).filter(isFile);

  if (files.length === 0) {
    console.log("No target TSX files found, skip hardcoded i18n check.");
    return;
  }

  const violations = files.flatMap((file) => scanFile(file));

  if (violations.length === 0) {
    console.log("i18n hardcoded text check passed.");
    return;
  }

  console.error("Found hardcoded UI copy. Please replace with i18n keys (t(...)):\n");
  for (const v of violations) {
    console.error(`- ${v.file}:${v.line} [${v.kind}] ${v.text}`);
  }

  process.exit(1);
}

main();
