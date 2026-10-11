import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './prompt.js';
import { toolsFor, runTool } from './tools.js';
import { check } from './guardrails.js';

export const MODEL = 'claude-sonnet-5';
export const MAX_TOKENS = 1600;
const MAX_TURNS = 8;

/**
 * One enquiry in, one reply out.
 *
 * Returns the draft rather than sending it. Nothing in this file touches a
 * mail server — approval mode is the default and sending is deliberately
 * somebody else's job.
 */
export async function reply({ property, enquiry, mode = 'approve', expectLanguage = null, client }) {
  const anthropic = client ?? new Anthropic();
  const started = Date.now();

  const system = buildSystemPrompt(property, { mode });
  const tools = toolsFor(property);
  const ctx = { escalations: [] };

  const messages = [{ role: 'user', content: enquiry }];
  const toolResults = [];
  const toolCalls = [];
  let usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let stop = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // The dossier and the rules are identical for every enquiry at this
      // property, so they are worth caching. The enquiry itself is not.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    usage = {
      input: usage.input + (res.usage?.input_tokens ?? 0),
      output: usage.output + (res.usage?.output_tokens ?? 0),
      cache_read: usage.cache_read + (res.usage?.cache_read_input_tokens ?? 0),
      cache_write: usage.cache_write + (res.usage?.cache_creation_input_tokens ?? 0),
    };
    stop = res.stop_reason;
    messages.push({ role: 'assistant', content: res.content });

    if (stop === 'refusal' || stop === 'max_tokens') break;

    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) break;

    const results = [];
    for (const u of uses) {
      let out;
      try {
        out = await runTool(property, u.name, u.input, ctx);
      } catch (err) {
        out = { error: String(err?.message ?? err) };
      }
      toolCalls.push({ name: u.name, input: u.input, output: out });
      toolResults.push(out);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }

  const text = messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');

  const verdict = check(text, { toolResults, property, expectLanguage });

  return {
    draft: text,
    stop_reason: stop,
    truncated: stop === 'max_tokens',
    refused: stop === 'refusal',
    tool_calls: toolCalls,
    escalations: ctx.escalations,
    escalated: ctx.escalations.length > 0,
    guardrails: verdict,
    /** A reply only goes out if the model finished AND the guardrails passed. */
    sendable: verdict.ok && stop === 'end_turn' && text.length > 0,
    mode,
    latency_ms: Date.now() - started,
    usage,
  };
}
