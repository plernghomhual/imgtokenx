#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const here = dirname(fileURLToPath(import.meta.url));
const { renderTextToImages } = await tsImport('../../src/core/library.ts', import.meta.url);

const ALL_MODELS = [
  'hy3-free',
  'north-mini-code-free',
  'nemotron-3-ultra-free',
  'deepseek-v4-flash-free',
  'mimo-v2.5-free',
  'big-pickle',
];
const SEEDS = [12345, 23456, 34567];
const MAX_WIDTH = 768;
const MAX_HEIGHT = 1932;

const PROFILES = [
  ['spleen-5x8', 'spleen-5x8', 0, 0],
  ['jetbrains-6x11', 'jetbrains-mono-10', 0, 0],
  ['spleen-7x10', 'spleen-5x8', 2, 2],
  ['jetbrains-7x13', 'jetbrains-mono-10', 1, 2],
  ['spleen-9x12', 'spleen-5x8', 4, 4],
  ['jetbrains-9x12', 'jetbrains-mono-10', 3, 1],
  ['spleen-10x16', 'spleen-5x8', 5, 8],
  ['spleen-11x18', 'spleen-5x8', 6, 10],
  ['spleen-12x20', 'spleen-5x8', 7, 12],
  ['spleen-14x22', 'spleen-5x8', 9, 14],
  ['spleen-20x32', 'spleen-5x8', 15, 24],
].map(([name, font, cellWBonus, cellHBonus]) => {
  const baseW = font === 'jetbrains-mono-10' ? 6 : 5;
  const baseH = font === 'jetbrains-mono-10' ? 11 : 8;
  const cellW = baseW + cellWBonus;
  const cellH = baseH + cellHBonus;
  return {
    name,
    cellW,
    cellH,
    cols: Math.floor((MAX_WIDTH - 8) / cellW),
    style: { font, cellWBonus, cellHBonus, aa: true },
  };
});

function parseArgs(argv) {
  const args = {
    models: ALL_MODELS,
    seeds: SEEDS,
    out: resolve(here, 'results.json'),
    dryRun: false,
    timeoutMs: 240_000,
    profileNames: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log('Usage: node eval/opencode-reader-capacity/run.mjs [--models csv] [--seeds csv] [--profiles csv] [--timeout-ms n] [--dry-run] [--out path]');
      process.exit(0);
    }
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--models') args.models = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
    else if (a.startsWith('--models=')) args.models = a.slice(9).split(',').map((v) => v.trim()).filter(Boolean);
    else if (a === '--seeds') args.seeds = argv[++i].split(',').map(Number);
    else if (a.startsWith('--seeds=')) args.seeds = a.slice(8).split(',').map(Number);
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a.startsWith('--out=')) args.out = resolve(a.slice(6));
    else if (a === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else if (a.startsWith('--timeout-ms=')) args.timeoutMs = Number(a.slice(13));
    else if (a === '--profiles') args.profileNames = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
    else if (a.startsWith('--profiles=')) args.profileNames = a.slice(11).split(',').map((v) => v.trim()).filter(Boolean);
    else if (!a.startsWith('-')) throw new Error(`unexpected argument: ${a}`);
    else if (a !== '--dry-run') throw new Error(`unknown option: ${a}`);
  }
  if (!args.models.length || !args.seeds.length || args.seeds.some((n) => !Number.isFinite(n))) {
    throw new Error('models and numeric seeds are required');
  }
  if (args.profileNames?.some((name) => !PROFILES.some((profile) => profile.name === name))) {
    throw new Error('unknown profile name');
  }
  return args;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function fixture(seed) {
  const next = rng(seed);
  const words = ['token', 'ledger', 'cache', 'session', 'stream', 'proxy', 'engine', 'router', 'buffer', 'atlas'];
  const pick = () => words[next() % words.length];
  const camel = pick() + pick()[0].toUpperCase() + pick().slice(1) + pick()[0].toUpperCase() + pick().slice(1);
  const truth = {
    hex: Array.from({ length: 12 }, () => (next() % 16).toString(16)).join(''),
    camel,
    path: `src/core/${pick()}-${100 + next() % 900}.ts`,
    port: String(10000 + next() % 50000),
    gist: '3',
    guard: 'NOT STATED',
  };
  const lines = [
    'SYNTHETIC IMGTOKENX READER FIXTURE',
    `TOKEN_CACHE_KEY=${truth.hex}`,
    `RUNTIME_FIELD=${truth.camel}`,
    `SOURCE_PATH=${truth.path}`,
    `PROXY_PORT=${truth.port}`,
    'RETRY_BUDGET=3 attempts; BACKOFF=250ms',
  ];
  for (let i = 0; i < 150; i++) {
    lines.push(`[${String(i).padStart(3, '0')}] trace=${next().toString(16).padStart(8, '0')} shard=${next() % 97} status=ok`);
  }
  return { text: lines.join('\n'), truth };
}

function prompt(extra = '') {
  return [
    'Read only the supplied synthetic transcript. Return one JSON object and no Markdown.',
    'Keys: "hex", "camel", "path", "port", "gist", "guard".',
    'Copy TOKEN_CACHE_KEY, RUNTIME_FIELD, SOURCE_PATH, and PROXY_PORT exactly, preserving case.',
    'Set gist to the retry-attempt count. No database password appears; set guard to "NOT STATED".',
    'If an exact value is unreadable, use "UNREADABLE"; never guess.',
    extra,
  ].filter(Boolean).join('\n');
}

function parseAnswer(text) {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    const value = JSON.parse(fenced ? fenced[1] : text.trim());
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function score(answer, truth, source) {
  if (!answer) return { pass: false, exact: 0, confabulations: 1, gist: false, guard: false, malformed: true };
  const exactKeys = ['hex', 'camel', 'path', 'port'];
  let exact = 0;
  let confabulations = 0;
  for (const key of exactKeys) {
    const got = String(answer[key] ?? '');
    if (got === truth[key]) exact++;
    else if (got !== 'UNREADABLE' && got !== 'NOT STATED' && !source.includes(got)) confabulations++;
  }
  const gist = String(answer.gist ?? '') === truth.gist;
  const guard = String(answer.guard ?? '') === truth.guard;
  return { pass: exact === 4 && gist && guard && confabulations === 0, exact, confabulations, gist, guard, malformed: false };
}

function inputTokens(tokens) {
  if (!tokens) return null;
  return Number(tokens.input || 0) + Number(tokens.cache?.read || 0) + Number(tokens.cache?.write || 0);
}

function classifyFailure(text) {
  if (/image.*(not supported|unsupported)|does not support.*image|attachment.*false/i.test(text)) return 'unsupported_image';
  if (/rate.?limit|too many requests|429/i.test(text)) return 'rate_limit';
  if (/unauthorized|authentication|401|403/i.test(text)) return 'auth';
  if (/unknown model|model.*not found|404/i.test(text)) return 'unknown_model';
  return 'transport';
}

async function callOpenCode(model, message, files, timeoutMs) {
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const argv = ['run', message, '--pure', '--format', 'json', '-m', `opencode/${model}`];
  for (const file of files) argv.push(`--file=${file}`);
  const started = Date.now();
  return await new Promise((resolveCall) => {
    const child = spawn(bin, argv, {
      shell: false,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killTree = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process already exited. */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveCall({ ok: false, category: 'transport', error: error.message, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const texts = [];
      let tokens = null;
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line);
          const part = event.part || {};
          if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
          if (part.type === 'step-finish' && part.tokens) tokens = part.tokens;
        } catch { /* OpenCode may print non-JSON diagnostics; stderr covers failures. */ }
      }
      const text = texts.join('').trim();
      if (timedOut) return resolveCall({ ok: false, category: 'timeout', error: 'timeout', ms: Date.now() - started });
      if (files.length > 0 && /(?:do(?:es)? not|doesn't|cannot|can't|unable to) (?:support|process|view|inspect|read|access).*image|image input (?:is )?(?:not supported|unsupported)/i.test(text)) {
        return resolveCall({ ok: false, category: 'unsupported_image', error: text.slice(0, 500), ms: Date.now() - started });
      }
      if (code !== 0 || !text) {
        const error = (stderr || stdout).trim().slice(0, 500);
        return resolveCall({ ok: false, category: classifyFailure(error), error, ms: Date.now() - started });
      }
      resolveCall({ ok: true, text, tokens, inputTokens: inputTokens(tokens), ms: Date.now() - started });
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const selectedProfiles = args.profileNames
  ? PROFILES.filter((profile) => args.profileNames.includes(profile.name))
  : PROFILES;
const results = { generatedAt: new Date().toISOString(), models: args.models, seeds: args.seeds, profiles: selectedProfiles, dryRun: args.dryRun, runs: [], recommendations: {} };
const work = await mkdtemp(join(tmpdir(), 'imgtokenx-opencode-eval-'));

try {
  for (const model of args.models) {
    let unsupported = false;
    for (const seed of args.seeds) {
      if (unsupported) break;
      const f = fixture(seed);
      const run = { model, seed, sourceChars: f.text.length, truth: f.truth, baseline: null, arms: [] };
      if (!args.dryRun) {
        const baseline = await callOpenCode(model, prompt(`\nTRANSCRIPT:\n${f.text}`), [], args.timeoutMs);
        run.baseline = { ...baseline, score: baseline.ok ? score(parseAnswer(baseline.text), f.truth, f.text) : null };
        console.log(`${model} seed ${seed} baseline: ${baseline.ok ? `${baseline.inputTokens} input tokens` : baseline.category}`);
      }
      for (const profile of selectedProfiles) {
        const rendered = await renderTextToImages(f.text, { cols: profile.cols, style: profile.style, maxHeightPx: MAX_HEIGHT, reflow: true, shrink: false, multiCol: 1 });
        if (rendered.droppedChars !== 0) throw new Error(`${model}/${seed}/${profile.name}: renderer dropped ${rendered.droppedChars} characters`);
        const armDir = join(work, model, String(seed), profile.name);
        await mkdir(armDir, { recursive: true });
        const files = [];
        const pages = [];
        for (let i = 0; i < rendered.pages.length; i++) {
          const page = rendered.pages[i];
          const file = join(armDir, `page-${i + 1}.png`);
          await writeFile(file, page.png);
          files.push(file);
          pages.push({ width: page.width, height: page.height, sha256: createHash('sha256').update(page.png).digest('hex') });
        }
        const arm = { profile: profile.name, pages, response: null, score: null, savingsPct: null };
        if (!args.dryRun) {
          arm.response = await callOpenCode(model, prompt(), files, args.timeoutMs);
          if (arm.response.ok) {
            arm.score = score(parseAnswer(arm.response.text), f.truth, f.text);
            if (run.baseline?.inputTokens && arm.response.inputTokens) {
              arm.savingsPct = Math.round((1 - arm.response.inputTokens / run.baseline.inputTokens) * 1000) / 10;
            }
          } else if (arm.response.category === 'unsupported_image') {
            unsupported = true;
          }
          console.log(`${model} seed ${seed} ${profile.name}: ${arm.response.ok ? `${arm.score.pass ? 'PASS' : 'FAIL'}; saved ${arm.savingsPct}%` : arm.response.category}`);
        }
        run.arms.push(arm);
        if (unsupported) break;
      }
      results.runs.push(run);
    }
  }

  for (const model of args.models) {
    const runs = results.runs.filter((r) => r.model === model);
    const unsupported = runs.some((r) => r.arms.some((a) => a.response?.category === 'unsupported_image'));
    if (unsupported) {
      results.recommendations[model] = { status: 'unsupported_image', safeToImage: false };
      continue;
    }
    const candidates = selectedProfiles.map((profile) => {
      const arms = runs.map((r) => r.arms.find((a) => a.profile === profile.name)).filter(Boolean);
      const passed = arms.length === args.seeds.length && arms.every((a) => a.score?.pass && a.savingsPct > 0);
      return { profile, arms, passed };
    });
    const winner = candidates.find((c) => c.passed);
    results.recommendations[model] = winner
      ? { status: 'accepted', safeToImage: true, profile: winner.profile.name, font: winner.profile.style.font, cellWBonus: winner.profile.style.cellWBonus, cellHBonus: winner.profile.style.cellHBonus, savingsPct: winner.arms.map((a) => a.savingsPct) }
      : { status: args.dryRun ? 'not_scored' : 'rejected', safeToImage: false };
  }

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Wrote ${args.out}`);
  console.log(JSON.stringify(results.recommendations, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
