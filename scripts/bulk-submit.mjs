/**
 * Bulk submit .md files to Sibyl for tagging.
 *
 * Usage:
 *   node poc/scripts/bulk-submit.mjs /path/to/md/files
 *
 * Requires the Next.js dev server to be running at http://localhost:3000
 *
 * Each .md file is parsed for:
 *   - Title:      first line starting with "# "
 *   - Source URL: last line matching "Source page: <url>" (used as join key for Azure SQL)
 *   - Content:    full file text passed to Claude for tagging
 */

import fs from 'fs';
import path from 'path';

const SIBYL_URL = 'http://localhost:3000/api/submit';
const DELAY_MS = 20000; // 20s between submissions — ensures previous Lambda invocation completes before next one starts (Bedrock throttles with concurrent calls)
const CONTENT_TYPE = 'article';

const dir = process.argv[2];

if (!dir) {
  console.error('Usage: node bulk-submit.mjs /path/to/md/files');
  process.exit(1);
}

if (!fs.existsSync(dir)) {
  console.error(`Directory not found: ${dir}`);
  process.exit(1);
}

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  const lines = raw.split('\n');

  // Title: first line starting with "# "
  const titleLine = lines.find((l) => l.startsWith('# '));
  const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(filePath, '.md').replace(/_/g, ' ');

  // Source URL: last non-empty line matching "Source page: <url>"
  const lastLine = lines[lines.length - 1].trim();
  const urlMatch = lastLine.match(/^Source(?:\s+page)?:\s+(https?:\/\/.+)$/i);
  const content_url = urlMatch ? urlMatch[1].trim() : null;

  return { title, content_url, content_text: raw };
}

async function submit(title, content_text, content_url) {
  const body = {
    content_type: CONTENT_TYPE,
    title,
    content_text,
    ...(content_url ? { content_url } : {}),
  };

  const res = await fetch(SIBYL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data.error ?? data)}`);
  }

  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));

  if (files.length === 0) {
    console.error(`No .md files found in ${dir}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} .md files — submitting to ${SIBYL_URL}\n`);

  let success = 0;
  let failed = 0;
  let noUrl = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file);

    try {
      const { title, content_url, content_text } = parseFile(file);

      if (!content_url) noUrl++;

      const { contentId } = await submit(title, content_text, content_url);

      console.log(`[${i + 1}/${files.length}] OK  ${name}`);
      console.log(`         content_id: ${contentId}`);
      console.log(`         url: ${content_url ?? '(none — will not join Azure SQL)'}`);

      success++;
    } catch (err) {
      console.error(`[${i + 1}/${files.length}] ERR ${name}: ${err.message}`);
      failed++;
    }

    if (i < files.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${success} submitted, ${failed} failed, ${noUrl} without source URL.`);
  if (noUrl > 0) {
    console.log(`Note: items without a source URL will be tagged but won't appear in analytics (no Azure SQL join key).`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
