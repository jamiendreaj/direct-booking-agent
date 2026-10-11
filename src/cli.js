#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadProperty, listProperties } from './property.js';
import { reply } from './agent.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const propertyId = flag('property', process.env.PROPERTY ?? 'example-lakecomo');
const mode = flag('mode', process.env.MODE ?? 'approve');
const lang = flag('lang', null);
const file = flag('file', null);

const enquiry = file
  ? readFileSync(file, 'utf8')
  : args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).join(' ');

if (!enquiry.trim()) {
  console.error(`Usage: npm run reply -- "the guest's message" [--property id] [--lang de] [--mode approve|auto]
       npm run reply -- --file enquiry.txt

Properties: ${listProperties().join(', ')}`);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const property = loadProperty(propertyId);
const r = await reply({ property, enquiry, mode, expectLanguage: lang });

const rule = (s) => `\n${'─'.repeat(64)}\n${s}`;
console.log(rule(`ENQUIRY → ${property.name}`));
console.log(enquiry.trim());

if (r.tool_calls.length) {
  console.log(rule('TOOLS'));
  for (const t of r.tool_calls) {
    const summary = t.output?.known === false ? `known:false — ${t.output.reason}` : JSON.stringify(t.output);
    console.log(`  ${t.name}(${JSON.stringify(t.input)})\n    → ${summary}`);
  }
}

console.log(rule(r.mode === 'approve' ? 'DRAFT — needs approval' : 'REPLY'));
console.log(r.draft || '(empty)');

if (r.escalated) {
  console.log(rule('ESCALATED TO OWNER'));
  for (const e of r.escalations) console.log(`  [${e.reason}] ${e.summary}`);
}

console.log(rule('CHECKS'));
console.log(`  guardrails   ${r.guardrails.ok ? 'pass' : 'BLOCKED'}`);
for (const i of r.guardrails.issues) console.log(`    ${i.severity === 'block' ? '✗' : '!'} ${i.rule} — ${i.detail}`);
console.log(`  stop_reason  ${r.stop_reason}`);
console.log(`  sendable     ${r.sendable}`);
console.log(`  latency      ${r.latency_ms} ms`);
console.log(`  tokens       in ${r.usage.input} · out ${r.usage.output} · cache read ${r.usage.cache_read} · cache write ${r.usage.cache_write}`);

process.exit(r.sendable ? 0 : 2);
