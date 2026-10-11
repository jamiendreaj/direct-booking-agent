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
properties/       one JSON dossier per hotel
evals/            42 cases, two-layer grading
dashboard/        the owner-facing results page
```

## Scope

Deliberately not in this repo, and all of it a real phase two: payments, dynamic
pricing, review responses, upsells, in-stay concierge, OTA guest messaging, PMS
write access. Each one is also a way to not ship.

---

Private. Not for distribution.
