/**
 * A second pair of eyes on the finished reply.
 *
 * The prompt tells the model what not to do; this checks whether it did it
 * anyway. The expensive failures in this product are all one of three things:
 * a price nobody authorised, a confirmed booking, or an answer in the wrong
 * language. Each gets a check.
 */

const PRICE = /(?:€|EUR\s?)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:€|euro|EUR)/gi;

const CONFIRMS = [
  /\b(?:i|we)\s+(?:have\s+)?(?:confirm|confirmed|reserved|booked|held)\b/i,
  /\byour\s+(?:room|booking|reservation)\s+is\s+(?:now\s+)?(?:confirmed|reserved|booked|held)\b/i,
  /\b(?:ho|abbiamo)\s+(?:confermat|prenotat|bloccat)/i,
  /\b(?:la\s+)?(?:sua\s+)?(?:camera|prenotazione)\s+è\s+(?:confermata|prenotata)\b/i,
  /\bich\s+habe\s+(?:das\s+Zimmer\s+)?(?:reserviert|gebucht|best(?:ä|ae)tigt)\b/i,
  /\bihr\s+Zimmer\s+ist\s+(?:reserviert|gebucht|best(?:ä|ae)tigt)\b/i,
];

const CARD = /\b(?:card\s+number|cvv|numero\s+di\s+carta|kreditkartennummer|iban)\b/i;

function numbersIn(text) {
  const out = new Set();
  for (const m of text.matchAll(PRICE)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/**
 * Every number any tool returned, flattened. A price in the reply is only
 * legitimate if it appears here, or in the dossier (city tax, parking, pets —
 * fixed fees the agent is allowed to state).
 */
function authorisedNumbers(toolResults, property) {
  const ok = new Set();
  const walk = (v) => {
    if (typeof v === 'number') ok.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  toolResults.forEach(walk);
  for (const n of numbersIn(JSON.stringify(property.facts ?? {}))) ok.add(n);
  return ok;
}

export function check(reply, { toolResults, property, expectLanguage }) {
  const issues = [];

  const authorised = authorisedNumbers(toolResults, property);
  for (const n of numbersIn(reply)) {
    if (!authorised.has(n)) {
      issues.push({ rule: 'unauthorised_price', severity: 'block', detail: `The reply states ${n} but no tool or dossier fee returned it.` });
    }
  }

  for (const re of CONFIRMS) {
    if (re.test(reply)) {
      issues.push({ rule: 'confirmed_booking', severity: 'block', detail: 'The reply appears to confirm or hold a booking.' });
      break;
    }
  }

  if (CARD.test(reply)) {
    issues.push({ rule: 'payment_detail', severity: 'block', detail: 'The reply mentions card or bank details.' });
  }

  if (expectLanguage) {
    const looksItalian = /\b(?:gentile|cordiali saluti|camera|prenotazione|colazione|disponibilit)/i.test(reply);
    if (expectLanguage !== 'it' && looksItalian) {
      issues.push({ rule: 'wrong_language', severity: 'block', detail: `Guest wrote in "${expectLanguage}" but the reply reads as Italian.` });
    }
  }

  if (/\b(?:usually|typically|normally|in genere|normalerweise|di solito)\b/i.test(reply)) {
    issues.push({ rule: 'hedged_fact', severity: 'warn', detail: 'Hedging language often marks a fact the dossier did not contain.' });
  }

  return { ok: !issues.some((i) => i.severity === 'block'), issues };
}
