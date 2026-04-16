#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const TARGET_FILES = [
  'src/components/workspace/settings/settings-dialog.tsx',
  'src/components/novel/ai/AiChatView.tsx',
  'src/components/novel/NovelCreationDialog.tsx',
  'src/components/novel/NovelSelector.tsx',
  'src/components/novel/outline/OutlineView.tsx',
  'src/components/novel/common/EntityDialog.tsx',
  'src/components/novel/sidebar/EntityManager.tsx',
  'src/components/novel/settings/NovelSettings.tsx',
  'src/components/novel/settings/PromptTemplateManager.tsx',
  'src/components/novel/settings/DataManagement.tsx',
];

const RULES = [
  {
    name: 'jsx-text',
    regex: />\s*([^<>{}]*[A-Za-z\u4e00-\u9fff][^<>{}]*)\s*</g,
    group: 1,
  },
  {
    name: 'jsx-attr-literal',
    regex:
      /\b(?:placeholder|title|aria-label|aria-description|alt|label)\s*=\s*["'`]([^"'`]*[A-Za-z\u4e00-\u9fff][^"'`]*)["'`]/g,
    group: 1,
  },
  {
    name: 'ui-call-literal',
    regex:
      /\b(?:confirm|alert|prompt|toast\.(?:success|error|warning|info))\(\s*["'`]([^"'`]*[A-Za-z\u4e00-\u9fff][^"'`]*)["'`]/g,
    group: 1,
  },
  {
    name: 'ui-object-literal',
    regex:
      /\b(?:label|title|description|placeholder|text)\s*:\s*["'`]([^"'`]*[A-Za-z\u4e00-\u9fff][^"'`]*)["'`]/g,
    group: 1,
  },
];

function stripInlineComment(line) {
  const commentIndex = line.indexOf('//');
  if (commentIndex === -1) {
    return line;
  }
  return line.slice(0, commentIndex);
}

function normalizeText(raw) {
  return raw.replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function shouldIgnore(text) {
  if (!text) return true;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return true;
  if (/^[-_./:\d\s]+$/.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  return false;
}

function checkFile(absPath) {
  const relativePath = path.relative(ROOT, absPath).replace(/\\/g, '/');
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((rawLine, index) => {
    const line = stripInlineComment(rawLine);

    RULES.forEach((rule) => {
      const regex = new RegExp(rule.regex.source, 'g');
      let match = regex.exec(line);
      while (match) {
        const literal = normalizeText(match[rule.group]);
        if (!shouldIgnore(literal)) {
          findings.push({
            file: relativePath,
            line: index + 1,
            rule: rule.name,
            text: literal,
          });
        }
        match = regex.exec(line);
      }
    });
  });

  return findings;
}

function main() {
  const allFindings = [];

  TARGET_FILES.forEach((relativePath) => {
    const absPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absPath)) {
      return;
    }
    allFindings.push(...checkFile(absPath));
  });

  if (allFindings.length === 0) {
    console.log('i18n hardcoded check passed (targeted TSX files).');
    return;
  }

  console.error('Found hardcoded UI literals in targeted TSX files:');
  allFindings.forEach((finding) => {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.rule}] ${JSON.stringify(finding.text)}`
    );
  });
  process.exit(1);
}

main();
