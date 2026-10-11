#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadProperty } from '../src/property.js';
import { reply, MODEL } from '../src/agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const JUDGE = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const propertyId = flag('property', process.env.PROPERTY ?? 'example-lakecomo');
const only = flag('case', null);
const useJudge = !has('no-judge');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

const property = loadProperty(propertyId);
const client = new Anthropic();
let cases = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
if (only) cases = cases.filter((c) => c.id === only || c.id.startsWith(only));
if (!cases.length) { console.error(`No case matching "${only}".`); process.exit(1); }

/* ── Code graders: deterministic, free, and the ones that must never regress ── */

function codeGrade(c, r) {
  const checks = [];
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail });
  const text = r.draft;

  add('finished', r.stop_reason === 'end_turn', `stop_reason=${r.stop_reason}`);
  add('guardrails', r.guardrails.ok,
    r.guardrails.issues.filter((i) => i.severity === 'block').map((i) => i.rule).join(', '));

  if (c.expect.escalate != null) {
    add('escalation', r.escalated === c.expect.escalate,
      `expected ${c.expect.escalate}, got ${r.escalated}`);
  }

  if (c.expect.escalate_reason) {
    const reasons = r.escalations.map((e) => e.reason);
    add('escalate_reason', reasons.includes(c.expect.escalate_reason),
      `expected ${c.expect.escalate_reason}, got [${reasons.join(', ') || 'none'}]`);
  }

  for (const t of c.expect.tools ?? []) {
    add(`tool:${t}`, r.tool_calls.some((x) => x.name === t), 'not called');
  }

  for (const m of c.expect.must_mention ?? []) {
    add(`mentions:${m}`, text.toLowerCase().includes(String(m).toLowerCase()), 'absent');
  }

  if (c.expect.must_not_match) {
    const re = new RegExp(c.expect.must_not_match);
    const hit = text.match(re);
    add('forbidden_pattern', !hit, hit ? `matched "${hit[0]}"` : '');
  }

  return checks;
}

/* ── Model grader: language and tone, which code cannot judge ── */

const JUDGE_SYSTEM = `You grade one reply written by a hotel's enquiry assistant. You are strict and you answer only with JSON.

Return exactly:
{"language":"<ISO 639-1 code of the language the reply is written in>","language_ok":<bool>,"tone_ok":<bool>,"grounded_ok":<bool>,"note":"<max 20 words>"}

language_ok: is the reply written in the expected language throughout? A reply that switches languages mid-way is false.
tone_ok: warm, direct, under about nine sentences, no emoji, no exclamation marks, does not open with "Thank you for your enquiry", signs off as the hotel. A reply that reads like a brochure or a chatbot is false.
grounded_ok: does every factual claim appear in the dossier or the tool results given to you? A plausible detail that is not in either is false.`;

async function judgeGrade(c, r) {
  const res = await client.messages.create({
    model: JUDGE,
    max_tokens: 400,
    system: JUDGE_SYSTEM,
    messages: [{
      role: 'user',
      content: `EXPECTED LANGUAGE: ${c.expect.language}

GUEST WROTE:
${c.enquiry}

TOOL RESULTS GIVEN TO THE ASSISTANT:
${JSON.stringify(r.tool_calls.map((t) => ({ [t.name]: t.output })), null, 1)}

DOSSIER FACTS:
${JSON.stringify({ rooms: property.room_types, facts: property.facts, faq: property.faq, booking: property.booking }, null, 1)}

THE REPLY TO GRADE:
${r.draft}`,
    }],
  });

  const raw = res.content.find((b) => b.type === 'text')?.text ?? '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [{ name: 'judge', pass: false, detail: 'judge returned no JSON' }];

  try {
    const v = JSON.parse(m[0]);
    return [
      { name: 'language', pass: v.language_ok === true, detail: `wrote ${v.language}, expected ${c.expect.language}` },
      { name: 'tone', pass: v.tone_ok === true, detail: v.note ?? '' },
      { name: 'grounded', pass: v.grounded_ok === true, detail: v.note ?? '' },
    ];
  } catch {
    return [{ name: 'judge', pass: false, detail: 'unparseable judge output' }];
  }
}

/* ── Run ── */

async function runCase(c) {
  try {
    const r = await reply({
      property, enquiry: c.enquiry, mode: 'approve',
      expectLanguage: c.expect.language, client,
    });
    const checks = [...codeGrade(c, r), ...(useJudge ? await judgeGrade(c, r) : [])];
    return { id: c.id, lang: c.lang, note: c.expect.note, result: r, checks, pass: checks.every((x) => x.pass) };
  } catch (err) {
    return { id: c.id, lang: c.lang, note: c.expect.note, error: String(err?.message ?? err),
             checks: [{ name: 'ran', pass: false, detail: String(err?.message ?? err) }], pass: false };
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

console.log(`${cases.length} cases · ${property.name} · agent ${MODEL}${useJudge ? ` · judge ${JUDGE}` : ' · no judge'}\n`);

const t0 = Date.now();
const results = await pool(cases, CONCURRENCY, runCase);

for (const r of results) {
  const failed = r.checks.filter((c) => !c.pass);
  console.log(`${r.pass ? ' PASS ' : ' FAIL '} ${r.id.padEnd(26)} ${r.result ? `${String(r.result.latency_ms).padStart(5)}ms` : '     —'}`);
  for (const f of failed) console.log(`        ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  if (!r.pass && r.note) console.log(`        · why this case: ${r.note}`);
}

const passed = results.filter((r) => r.pass).length;
const tok = results.reduce((a, r) => a + (r.result?.usage?.output ?? 0), 0);
const cached = results.reduce((a, r) => a + (r.result?.usage?.cache_read ?? 0), 0);

console.log(`\n${'─'.repeat(64)}`);
console.log(`${passed}/${results.length} passed  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s  ·  ${tok} output tokens  ·  ${cached} cached input`);

const byLang = {};
for (const r of results) {
  byLang[r.lang] ??= { pass: 0, total: 0 };
  byLang[r.lang].total++;
  if (r.pass) byLang[r.lang].pass++;
}
console.log('by language: ' + Object.entries(byLang).map(([l, v]) => `${l} ${v.pass}/${v.total}`).join('  ·  '));

mkdirSync(join(HERE, '..', 'logs'), { recursive: true });
const out = join(HERE, '..', 'logs', `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ model: MODEL, judge: useJudge ? JUDGE : null, property: property.id, passed, total: results.length, results }, null, 2));
console.log(`full log: ${out}`);

process.exit(passed === results.length ? 0 : 1);
