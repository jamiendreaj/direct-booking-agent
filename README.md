# Direct Booking Agent

A multilingual pre-booking enquiry agent for independent hotels. It answers a
prospective guest in the language they wrote in, using only the property's own
information, and routes the booking to the hotel's own website instead of an OTA.

Built against the business plan: one sector, one agent, one first client.

---

## Why this exists

Independent hotels lose about 63% of their bookings to OTAs at an all-in cost of
18–30%, against 5–12% on the direct channel. The bookings are not usually lost on
price — they are lost on **response time and language**. A German family emails at
21:00 asking whether the room sleeps four and whether the dog is allowed; the owner
reads it at 08:00; by then the guest has booked on an OTA, where the answer was
visible instantly.

The hotel had already won that guest. It just answered too slowly, in the wrong
language.

## What it does, and what it refuses to do

| Does | Never does |
| --- | --- |
| Answers pre-booking enquiries in the guest's language | Takes payment, or accepts card details |
| Quotes rates returned by a tool | States a price no tool returned |
| Sends the direct booking link | Confirms or holds a reservation |
| Escalates with a summary for the owner | Invents a fact absent from the dossier |
| Logs every enquiry, language and response time | Handles complaints, groups or negotiations |

The refusals are the product. An owner who hears the boundaries named out loud
trusts what sits inside them.

---

## Quick start

```bash
npm install
cp .env.example .env            # then add your ANTHROPIC_API_KEY

# One enquiry, one draft
npm run reply -- "Guten Tag, haben Sie ein Zimmer für vier Personen im Juli?" --lang de

# The whole eval suite
npm run eval

# One case, while iterating on the prompt
npm run eval -- --case de-family-occupancy
```

`npm run reply` exits `0` when the draft is sendable and `2` when the guardrails
blocked it. `npm run eval` exits `0` only when every case passes.

---

## Adding a property

1. Copy `properties/_template.json` to `properties/<slug>.json`.
2. Fill it in from the hotel's own website, then close the gaps in a 30-minute call
   with the owner. **Every blank is a question the agent will have to escalate.**
3. Run `npm run eval -- --property <slug>` and read the failures. Most will be
   missing dossier facts rather than prompt problems.

The loader fails loudly on an incomplete file rather than degrading quietly at
reply time — a half-filled dossier is the single most likely cause of a wrong
answer reaching a guest.

### Rate sources

`booking.rate_source` picks the adapter in `src/adapters/`:

- **`manual`** — the honest default. No availability feed and no rate feed, so the
  agent answers everything it can from the dossier and escalates the rest. This is
  what most small Italian properties start on, and it is a perfectly good pilot.
- **`static`** — a seasonal rate card in the property file. Prices each night on
  its own period, so a stay straddling a season boundary is quoted correctly.
  Availability is still unknown: a rate card says what a room costs, never whether
  it is free.

A real PMS integration is a third adapter, added **after** the pilot has shown it
is earning. For the pilot: no write access, ever.

---

## Approval mode

`MODE=approve` is the default and it is the most important design decision here.

Hoteliers are afraid of an AI emailing guests unsupervised, and they are right to
be. In approval mode every reply is drafted for the owner to approve with one
click. After two weeks of watching it get everything right, most owners ask to
switch it to `auto` themselves — they arrive at autonomy on their own schedule,
and you never have to argue for it.

`reply()` returns a draft and never sends. Nothing in this repo touches a mail
server; sending is deliberately somebody else's job.

---

## The three rules

The system prompt is the product, and almost all of its value is three rules:

1. **Grounding.** Every factual claim comes from the dossier or a tool result. A
   gap is escalated, never filled with something plausible.
2. **Prices come from `get_rate`, never from the model.** No estimates, no ranges,
   no mental arithmetic, no discounts.
3. **It does not close.** No confirmations, no holds, no payment details.

`src/guardrails.js` then checks the finished draft for exactly the failures those
rules are meant to prevent — an unauthorised number, a confirmed booking, card
details, the wrong language. The prompt says what not to do; the guardrails check
whether it did it anyway. A draft is only `sendable` when the model finished
cleanly **and** the guardrails passed.

---

## Evals

`evals/cases.json` holds 42 cases across seven languages: 26 that should be
answered and 16 that should be escalated.

Each case carries a `note` explaining why it exists, printed when it fails. The
ones worth knowing about:

| Case | What it catches |
| --- | --- |
| `de-family-occupancy` | The canonical enquiry. Only one room type sleeps four, and the reply must be in German |
| `en-rate-season-straddle` | Pricing a stay across a season boundary at the arrival-night rate |
| `en-roughly-how-much` | No dates means no tool call, which must mean no number at all |
| `en-availability` | Asserting a room is free with no availability feed |
| `en-pool-false-premise` | Playing along with a facility the hotel does not have |
| `en-card-details` | Echoing card data back, instead of warning and escalating |
| `en-injection` | Leaking the system prompt |
| `de-two-questions-one-unknown` | Answering the known half and escalating only the unknown half |
| `en-are-you-a-bot` | Claiming to be human |

Grading is two-layer. **Code graders** are deterministic and free: escalation,
escalation reason, tools called, required and forbidden strings, guardrail
verdict, `stop_reason`. A **model grader** then judges what code cannot — whether
the reply is genuinely in the right language throughout, whether the tone holds,
and whether every claim traces to the dossier or a tool result.

Run `npm run eval -- --no-judge` for the free, fully deterministic subset.

Every run writes a full log to `logs/`.

---

## The dashboard

`dashboard/index.html` is the owner-facing page, in Italian: enquiries, median
response time, language mix, escalations, direct bookings, and estimated margin
recovered. It opens on clearly-labelled demo data and loads `dashboard/data.json`
when that file is present.

This page is what renews the contract. The agent earns the first month; the
dashboard earns the twelfth.

---

## Layout

```
src/
  prompt.js       the system prompt, built from a property dossier
  tools.js        the four tools, and the dispatcher
  agent.js        the loop: Claude, tools, guardrails, one draft out
  guardrails.js   post-hoc checks on the finished draft
  property.js     dossier loading and loud validation
  adapters/       rate and availability sources
  cli.js          one enquiry in, one draft out
  *.test.js       31 tests, no network, no API key
properties/       one JSON dossier per hotel (real ones gitignored)
evals/            42 cases, two-layer grading
dashboard/        the owner-facing results page
```

## Tests

```bash
npm test
```

31 tests, all offline. `reply()` takes an injectable `client`, so the whole
agent loop runs against scripted responses — no network, no API key, nothing
that fails for a reason unrelated to the code. CI runs the same command.

The suite concentrates on the two places this system can embarrass a hotel:

**`guardrails.js`** — every rule, in every language it claims to cover. A price
no tool returned. A booking confirmed that was never held. Card details echoed
back. An Italian reply to a German guest. Plus the quieter cases: European
decimal formatting (`1.234,56` is twelve hundred, not one point two), and a
year in a sentence about the building is not a price.

**`agent.js`** — the failure modes that look identical to naive code. A
truncated reply, a refusal, a blown token budget, and the one that catches
people out: a response that finishes cleanly and contains **no text block at
all**, because reasoning consumed the output budget. Reading `content[0].text`
there throws an error that says nothing about the cause. The agent names it
instead, in `blocked_because`.

## Cost

A tool loop is where spend runs away: the model calls a tool, dislikes the
answer, calls it again, and every turn resends the whole conversation.
`MAX_TURNS` caps how many round trips there are. `DEFAULT_TOKEN_BUDGET` caps
how large they get, which is the number that reaches the bill.

```js
const r = await reply({ property, enquiry, tokenBudget: 25_000 });
r.tokens_used      // what it actually spent
r.budget_exhausted // true if it stopped at the ceiling
```

The budget is checked *before* running tools, not after — a tool result returns
as input on the next turn, so continuing past the ceiling spends again. The
system prompt is cached, so a second enquiry at the same property re-reads the
dossier at a fraction of the cost.

## What is in this repository, and what is not

The framework is public. Client material is not.

Only `_template.json` and the fictional `example-lakecomo.json` are tracked;
every other property dossier is gitignored. Dossiers carry rates, owner contact
details, and a `prompt_overlay` field whose contents are appended to the system
prompt as house instructions for that hotel.

That is deliberate. The overlay is where per-client tuning accumulates — the
phrasing an owner wants, the question that keeps coming up, the thing that went
wrong last month. It is appended last so it can sharpen the standing rules, and
it cannot loosen them: the three grounding rules and the escalation list are not
overridable from a dossier.

See [`properties/README.md`](properties/README.md).

## Scope

Deliberately not in this repo, and all of it a real phase two: payments, dynamic
pricing, review responses, upsells, in-stay concierge, OTA guest messaging, PMS
write access. Each one is also a way to not ship.

---

The framework is open. Property dossiers, client data and per-hotel
instructions are not, and never enter this repository.
