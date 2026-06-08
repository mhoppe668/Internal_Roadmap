#!/usr/bin/env node
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN     = process.env.AHA_API_TOKEN;
const SUBDOMAIN = process.env.AHA_SUBDOMAIN;

if (!TOKEN || !SUBDOMAIN) {
  console.error('AHA_API_TOKEN and AHA_SUBDOMAIN environment variables are required');
  process.exit(1);
}

const BASE = `https://${SUBDOMAIN}.aha.io/api/v1`;

const VALID_TIMEFRAMES = new Set([
  '2026', '2026 Q1', '2026 Q2', '2026 Q3', '2026 Q4',
  '2027', '2027 Q1', '2027 Q2', '2027 Q3', '2027 Q4'
]);

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }
    }, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try   { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
  });
}

// Strip Aha!'s HTML description body to plain text
function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAllInitiatives() {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${BASE}/products/AGL/initiatives?per_page=200&page=${page}`;
    console.log(`Fetching page ${page}: ${url}`);
    const res = await get(url);
    const batch = res.initiatives || [];
    all.push(...batch);
    const p = res.pagination;
    if (!p || page >= p.total_pages || batch.length === 0) break;
    page++;
  }
  return all;
}

async function main() {
  const raw = await fetchAllInitiatives();
  console.log(`Total fetched: ${raw.length}`);

  const initiatives = raw.filter(i => {
    // Must not be archived
    if (i.archived) return false;

    // Filter by Aha! timeframe name if present (e.g. "2026 Q3")
    const tfName = i.time_frame && (i.time_frame.name || i.time_frame.period_name);
    if (tfName !== undefined && tfName !== null) return VALID_TIMEFRAMES.has(tfName);

    // Fallback: keep if end date falls within 2026-01-01 to 2027-12-31
    const end = i.end_date ? new Date(i.end_date + 'T00:00:00') : null;
    return end !== null
      && end >= new Date('2026-01-01')
      && end <= new Date('2027-12-31');
  });

  console.log(`After filtering: ${initiatives.length}`);

  const items = initiatives.map(i => {
    // Progress may be a bare number or an object { value: number }
    const progress = typeof i.progress === 'number'               ? i.progress
                   : i.progress && typeof i.progress.value === 'number' ? i.progress.value
                   : 0;

    // Goals may or may not be returned by the list endpoint
    const goals = Array.isArray(i.goals)
      ? i.goals.map(g => g.name || g.reference_num).filter(Boolean)
      : [];

    return {
      name:     i.name || '',
      s:        i.start_date || null,
      e:        i.end_date   || null,
      status:   (i.workflow_status && i.workflow_status.name) || 'Not started',
      desc:     stripHtml((i.description && i.description.body) || ''),
      progress,
      goals
    };
  });

  const output = [{ ws: 'Agility', items }];
  const outPath = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${items.length} initiatives to data.json`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
