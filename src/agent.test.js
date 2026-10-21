/**
 * Tests for the agent loop.
 *
 * `reply()` takes an injectable `client`, so the whole loop can be driven
 * against scripted responses with no network and no API key. Every case here
 * is a failure seen in production rather than one imagined for the test.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { reply, DEFAULT_TOKEN_BUDGET } from './agent.js';

const property = {
  id: 'test',
  name: 'Hotel Test',
  town: 'Menaggio',
  country: 'Italy',
  languages: ['it', 'en'],
  room_types: [{ name: 'Doppia', sleeps: 2, beds: 'one queen' }],
  facts: { parking: '14 spaces at €18 a night' },
  booking: { direct_url: 'https://example.invalid/booking', direct_advantage: '', rate_source: 'static' },
  escalate: { always: ['groups over 6'] },
};

/** A client that replays scripted responses, one per turn. */
function fakeClient(turns) {
  let i = 0;
  return {
    calls: [],
    messages: {
      create(req) {
        const self = this;
        self.calls = self.calls ?? [];
        const turn = turns[Math.min(i, turns.length - 1)];
        i += 1;
        return Promise.resolve({
          stop_reason: turn.stop ?? 'end_turn',
          content: turn.content ?? [{ type: 'text', text: turn.text ?? '' }],
          usage: {
            input_tokens: turn.input ?? 100,
            output_tokens: turn.output ?? 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      },
    },
  };
}

const run = (turns, opts = {}) =>
  reply({ property, enquiry: 'Do you have parking?', client: fakeClient(turns), ...opts });

test('a clean reply is sendable', async () => {
  const r = await run([{ text: 'Yes, parking is €18 a night. https://example.invalid/booking' }]);
  assert.equal(r.sendable, true);
  assert.equal(r.blocked_because, null);
  assert.equal(r.stop_reason, 'end_turn');
});

test('a truncated reply is never sendable', async () => {
  const r = await run([{ stop: 'max_tokens', text: 'Yes, parking is' }]);
  assert.equal(r.sendable, false);
  assert.equal(r.truncated, true);
  assert.match(r.blocked_because, /cut off/);
});

test('a refusal is never sendable', async () => {
  const r = await run([{ stop: 'refusal', text: '' }]);
  assert.equal(r.sendable, false);
  assert.equal(r.refused, true);
});

test('finishing with no text block is reported as such, not as a crash', async () => {
  // The real failure: reasoning consumed the output budget, so the response
  // carries content blocks but none of them are text. Naive code does
  // content[0].text and throws something unrelated to the cause.
  const r = await run([{ content: [{ type: 'thinking', thinking: 'at length...' }] }]);
  assert.equal(r.sendable, false);
  assert.equal(r.draft, '');
  assert.match(r.blocked_because, /no text/);
});

test('a guardrail block is surfaced with the rule named', async () => {
  const r = await run([{ text: 'I have confirmed the room for you.' }]);
  assert.equal(r.sendable, false);
  assert.match(r.blocked_because, /confirmed_booking/);
});

test('an unauthorised price blocks the reply', async () => {
  const r = await run([{ text: 'The Doppia is €240 a night.' }]);
  assert.equal(r.sendable, false);
  assert.match(r.blocked_because, /unauthorised_price/);
});

test('the token budget stops a runaway tool loop', async () => {
  // Every turn asks for a tool and spends heavily. Without a ceiling this runs
  // to MAX_TURNS; with one it stops as soon as the budget is gone.
  const greedy = {
    content: [{ type: 'tool_use', id: 't1', name: 'get_rate', input: {} }],
    input: 9_000,
    output: 1_000,
  };
  const r = await run([greedy], { tokenBudget: 25_000 });
  assert.equal(r.budget_exhausted, true);
  assert.equal(r.sendable, false);
  assert.match(r.blocked_because, /budget/);
  assert.ok(r.tokens_used >= 25_000, 'stops at the ceiling, not far past it');
  assert.ok(r.tokens_used < 60_000, `spent ${r.tokens_used}, should not have run to MAX_TURNS`);
});

test('a reply well inside the budget is unaffected', async () => {
  const r = await run([{ text: 'Parking is €18 a night.' }]);
  assert.equal(r.budget_exhausted, false);
  assert.equal(r.token_budget, DEFAULT_TOKEN_BUDGET);
  assert.ok(r.tokens_used > 0);
});

test('usage is accumulated across turns, not overwritten', async () => {
  const r = await run([
    { content: [{ type: 'tool_use', id: 't1', name: 'get_rate', input: {} }], input: 100, output: 20 },
    { text: 'Parking is €18 a night.', input: 150, output: 30 },
  ]);
  assert.equal(r.usage.input, 250);
  assert.equal(r.usage.output, 50);
});

test('a tool that throws does not kill the run', async () => {
  const r = await run([
    { content: [{ type: 'tool_use', id: 't1', name: 'does_not_exist', input: {} }] },
    { text: 'Parking is €18 a night.' },
  ]);
  assert.equal(r.tool_calls.length, 1);
  assert.ok('error' in r.tool_calls[0].output, 'the failure is captured, not thrown');
  assert.equal(r.sendable, true, 'the model still got to answer');
});

test('latency and usage are always reported', async () => {
  const r = await run([{ text: 'Parking is €18 a night.' }]);
  assert.equal(typeof r.latency_ms, 'number');
  assert.ok(r.latency_ms >= 0);
  assert.deepEqual(Object.keys(r.usage).sort(), ['cache_read', 'cache_write', 'input', 'output']);
});

test('the system prompt is sent with cache_control', async () => {
  const client = fakeClient([{ text: 'Parking is €18 a night.' }]);
  let seen = null;
  const create = client.messages.create.bind(client.messages);
  client.messages.create = (req) => { seen = req; return create(req); };
  await reply({ property, enquiry: 'parking?', client });
  assert.equal(seen.system[0].cache_control.type, 'ephemeral',
    'the dossier is identical per property and must stay cached');
});
