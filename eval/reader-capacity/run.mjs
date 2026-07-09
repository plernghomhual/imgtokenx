// Generic reader-capacity sweep. See README.md.
// Dry-run (no key): renders every variant and prints token/savings accounting.
// Full run (ANTHROPIC_API_KEY set): also calls the models and scores the battery.
//
// Run: node eval/reader-capacity/run.mjs claude-opus-4-8,claude-fable-5
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const here = dirname(fileURLToPath(import.meta.url));
const { renderTextToImages } = await tsImport('../../src/core/library.ts', import.meta.url);

const DEFAULT_MODELS = ['claude-opus-4-8', 'claude-fable-5'];

function usage() {
  return [
    'Usage: node eval/reader-capacity/run.mjs [model-a,model-b] [--dry-run] [--out path] [--profiles-out path]',
    '',
    'Examples:',
    '  node eval/reader-capacity/run.mjs --dry-run',
    '  node eval/reader-capacity/run.mjs claude-opus-4-8,gpt-5.5 --dry-run',
    '  ANTHROPIC_API_KEY=sk-ant-... node eval/reader-capacity/run.mjs claude-opus-4-8 --profiles-out /tmp/reader-profile.txt',
  ].join('\n');
}

function parseArgs(argv) {
  let modelsArg = null;
  let out = join(here, 'results.json');
  let profilesOut = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--out') {
      out = argv[++i];
      if (!out) throw new Error('--out requires a path');
    } else if (a.startsWith('--out=')) {
      out = a.slice('--out='.length);
    } else if (a === '--profiles-out') {
      profilesOut = argv[++i];
      if (!profilesOut) throw new Error('--profiles-out requires a path');
    } else if (a.startsWith('--profiles-out=')) {
      profilesOut = a.slice('--profiles-out='.length);
    } else if (a.startsWith('-')) {
      throw new Error(`unknown option: ${a}`);
    } else if (modelsArg === null) {
      modelsArg = a;
    } else {
      throw new Error(`unexpected argument: ${a}`);
    }
  }

  const models = (modelsArg ?? DEFAULT_MODELS.join(','))
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) throw new Error('at least one model id is required');
  return {
    models,
    out: out === '-' ? out : resolve(process.cwd(), out),
    profilesOut: profilesOut ? resolve(process.cwd(), profilesOut) : null,
    dryRun,
  };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  console.error(usage());
  process.exit(2);
}

// Anthropic bills 28-px patches; pxpipe pages are <=1568x728 (both tiers, no
// downscale), so the raw patch count is the exact per-image cost.
const patchTokens = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);

// --- Fixture: one synthetic session with embedded precision-critical tokens ---
const TRUTH = {
  hex: 'a3f9c1e0b7d2',
  camel: 'tokenLedgerShard',
  path: 'src/core/anthropic-vision.ts',
  flag: '--max-visual-tokens',
  port: '47821',
  decisionKey: 'retry budget', // gist: a decision that survives lossy reads
  decisionVal: '3 attempts',
};
const SESSION = [
  '<user t="1">Wire up the retry path. Use a retry budget of 3 attempts, backing off 250ms.</user>',
  `<assistant t="2">Done. The token cache key is ${TRUTH.hex}. I renamed the field to ${TRUTH.camel}`,
  `and moved the tier math into ${TRUTH.path}. The CLI now takes ${TRUTH.flag}. Proxy stays on port ${TRUTH.port}.</assistant>`,
  '<user t="3">Good. Keep the retry budget as decided; do not change the backoff.</user>',
  // padding so the page is realistically dense
  ...Array.from({ length: 40 }, (_, i) =>
    `<assistant t="${4 + i}">step ${i}: processed shard ${i} of the ${TRUTH.camel}, ok, continuing the run.</assistant>`),
].join('\n');

const QUESTIONS = [
  { id: 'hex', kind: 'exact', q: 'What is the exact token cache key (12-char hex) mentioned in the transcript?', answer: TRUTH.hex },
  { id: 'camel', kind: 'exact', q: 'What is the exact field name the assistant renamed the field to?', answer: TRUTH.camel },
  { id: 'path', kind: 'exact', q: 'What exact file path did the tier math move into?', answer: TRUTH.path },
  { id: 'port', kind: 'exact', q: 'What port does the proxy stay on?', answer: TRUTH.port },
  { id: 'gist', kind: 'gist', q: 'What retry budget was decided (a number of attempts)?', answer: '3' },
  { id: 'guard', kind: 'guard', q: 'What database password was configured in this session? If it was not stated, say "NOT STATED".', answer: 'NOT STATED' },
];

// Fewer, wider cells -> drop `cols` so the canvas stays <= 1568 px wide (the cap
// that keeps every page in Anthropic's linear, no-downscale billing window).
// cols = floor((1568 - 2*PAD_X) / cellW), cellW = 5 + cellWBonus, PAD_X = 4.
const colsFor = (wBonus) => Math.floor((1568 - 8) / (5 + wBonus));
const VARIANTS = [
  { name: '5x8', style: { cellWBonus: 0, cellHBonus: 0, aa: true }, cols: colsFor(0) },
  { name: '7x10', style: { cellWBonus: 2, cellHBonus: 2, aa: true }, cols: colsFor(2) },
  { name: '9x12', style: { cellWBonus: 4, cellHBonus: 4, aa: true }, cols: colsFor(4) },
];

const TEXT_TOKENS = Math.ceil(SESSION.length / 3.5); // rough Claude-Code-dense baseline

async function callModel(model, dataUrls, question) {
  const key = process.env.ANTHROPIC_API_KEY;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const content = [
    ...dataUrls.map((u) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: u.replace(/^data:image\/png;base64,/, '') },
    })),
    { type: 'text', text: question + '\nAnswer with ONLY the exact value, or "NOT STATED" if it is not present. Do not guess.' },
  ];
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    // 128 was too small: always-on-thinking models (Fable 5) spend the whole
    // budget on thinking and return no answer text. Give the answer room.
    body: JSON.stringify({ model, max_tokens: 512, messages: [{ role: 'user', content }] }),
  });
  const body = await res.text();
  let j = null;
  try {
    j = JSON.parse(body);
  } catch {
    // leave j null; the HTTP/error branch below will carry the short body
  }
  if (!res.ok || j?.error) {
    const msg = j?.error?.message || body.slice(0, 300) || `HTTP ${res.status}`;
    return { text: '', ms: Date.now() - t0, stop: 'api_error', cat: `HTTP ${res.status}`, error: msg };
  }
  const stop = j?.stop_reason ?? null;
  const cat = j?.stop_details?.category ?? null;
  // Find the TEXT block, not content[0]: on always-on-thinking models content[0]
  // is a thinking block (empty text under the default omitted display).
  const text = ((j?.content ?? []).find((b) => b?.type === 'text')?.text ?? '').trim();
  return { text, ms: Date.now() - t0, stop, cat, error: null };
}

function score(kind, expected, got, stop) {
  // A classifier refusal (HTTP 200, stop_reason:"refusal", empty content) is a
  // SAFE no-answer -- it is NOT a confabulation. Scoring it as confab inverts the
  // safety verdict, so branch on it first.
  if (stop === 'refusal') return { ok: false, abstained: false, confab: false, refused: true };
  const g = got.toLowerCase();
  const abstained = /not stated|unknown|not safe|can't|cannot|not present/.test(g);
  if (kind === 'guard') return { ok: abstained, abstained, confab: !abstained, refused: false };
  if (kind === 'gist') return { ok: g.includes(String(expected).toLowerCase()), abstained, confab: false, refused: false };
  // exact
  const ok = got.includes(expected);
  return { ok, abstained, confab: !ok && !abstained, refused: false };
}

function accepted(row, m) {
  if (m.error) return false;
  const exact = m.answers.filter((a) => a.kind === 'exact');
  const exactConfab = exact.filter((a) => a.confab).length;
  return exact.length > 0 && exactConfab === 0 && m.gistOk && m.guardOk && row.imageTokens < TEXT_TOKENS;
}

function profileFor(row) {
  return {
    safeToImage: true,
    cellWBonus: row.style.cellWBonus,
    cellHBonus: row.style.cellHBonus,
  };
}

function recommend(results, model) {
  let sawScore = false;
  let sawError = false;
  for (const row of results.variants) {
    const m = row.models[model];
    if (!m) continue;
    if (m.error) {
      sawError = true;
      continue;
    }
    sawScore = true;
    if (accepted(row, m)) {
      return {
        status: 'accepted',
        variant: row.variant,
        savingsPct: row.savingsPct,
        profile: profileFor(row),
      };
    }
  }
  if (!sawScore) {
    return {
      status: sawError ? 'api_error' : 'not_scored',
      profile: null,
      reason: sawError ? 'live scoring returned an API error' : 'dry run: no live model scores',
    };
  }
  return {
    status: 'rejected',
    profile: { safeToImage: false, cellWBonus: 0, cellHBonus: 0 },
    reason: 'no variant cleared the acceptance bar',
  };
}

function profileLine(model, rec) {
  if (rec.status === 'accepted') {
    return `${model}: { safeToImage: true, cellWBonus: ${rec.profile.cellWBonus}, cellHBonus: ${rec.profile.cellHBonus} } // ${rec.variant}, ${rec.savingsPct}% saved`;
  }
  if (rec.status === 'rejected') {
    return `${model}: { safeToImage: false, cellWBonus: 0, cellHBonus: 0 } // ${rec.reason}`;
  }
  return `${model}: not emitted // ${rec.reason}`;
}

const live = Boolean(process.env.ANTHROPIC_API_KEY) && !args.dryRun;
const results = {
  generatedAt: new Date().toISOString(),
  models: args.models,
  textTokens: TEXT_TOKENS,
  dryRun: !live,
  variants: [],
  recommendations: {},
};

console.log(`Models: ${args.models.join(', ')}`);
if (!live) console.log('Dry run: no model calls. Set ANTHROPIC_API_KEY and omit --dry-run to score.');

for (const v of VARIANTS) {
  const { pages } = await renderTextToImages(SESSION, { style: v.style, cols: v.cols, reflow: true });
  const imageTokens = pages.reduce((n, p) => n + patchTokens(p.width, p.height), 0);
  const dataUrls = pages.map((p) => 'data:image/png;base64,' + Buffer.from(p.png).toString('base64'));
  const savingsPct = Math.round((1 - imageTokens / TEXT_TOKENS) * 100);
  const row = {
    variant: v.name,
    style: v.style,
    cols: v.cols,
    pages: pages.length,
    dims: pages.map((p) => `${p.width}x${p.height}`),
    imageTokens,
    savingsPct,
    models: {},
  };
  console.log(`\n[${v.name}] ${pages.length} page(s) ${row.dims.join(',')} -> ${imageTokens} img tok vs ${TEXT_TOKENS} text (${savingsPct}% saved)`);

  if (live) {
    for (const model of args.models) {
      const m = { exactCorrect: 0, exactTotal: 0, confab: 0, abstain: 0, refused: 0, refusalCat: null, gistOk: false, guardOk: false, answers: [] };
      for (const q of QUESTIONS) {
        const { text, ms, stop, cat, error } = await callModel(model, dataUrls, q.q);
        if (error) {
          m.error = error;
          m.answers.push({ id: q.id, kind: q.kind, expected: q.answer, got: text, stop, cat, error, ms });
          break;
        }
        const s = score(q.kind, q.answer, text, stop);
        m.answers.push({ id: q.id, kind: q.kind, expected: q.answer, got: text, stop, cat, ...s, ms });
        if (q.kind === 'exact') { m.exactTotal++; if (s.ok) m.exactCorrect++; }
        if (s.confab) m.confab++;
        if (s.abstained) m.abstain++;
        if (s.refused) { m.refused++; m.refusalCat = m.refusalCat || cat; }
        if (q.kind === 'gist' && !s.refused) m.gistOk = s.ok;
        // A refused guard is SAFE (the model didn't state the never-stated fact),
        // so it passes the guard just like an abstention does.
        if (q.kind === 'guard') m.guardOk = s.ok || s.refused;
      }
      row.models[model] = m;
      if (m.error) {
        console.log(`  ${model}: ERROR ${m.error}`);
      } else {
        const refNote = m.refused ? `, REFUSED ${m.refused}/${QUESTIONS.length}${m.refusalCat ? ` (${m.refusalCat})` : ''}` : '';
        console.log(`  ${model}: exact ${m.exactCorrect}/${m.exactTotal}, confab ${m.confab}, abstain ${m.abstain}${refNote}, gist ${m.gistOk ? 'ok' : 'MISS'}, guard ${m.guardOk ? 'ok' : 'FAIL'}`);
      }
    }
  } else {
    console.log('  (dry run -- rendering/accounting only)');
  }
  results.variants.push(row);
}

console.log('\n[reader-profiles.ts candidates]');
for (const model of args.models) {
  const rec = recommend(results, model);
  results.recommendations[model] = rec;
  console.log(profileLine(model, rec));
}

if (args.profilesOut) {
  const lines = args.models.map((model) => profileLine(model, results.recommendations[model]));
  writeFileSync(args.profilesOut, `${lines.join('\n')}\n`);
  console.log(`Wrote ${args.profilesOut}`);
}

if (args.out !== '-') {
  writeFileSync(args.out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${args.out}`);
} else {
  console.log(JSON.stringify(results, null, 2));
}
