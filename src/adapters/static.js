/**
 * Rates from a seasonal rate card in the property file.
 *
 * Used for the demo and for properties whose owner gives a fixed seasonal card.
 * Availability is still unknown — a rate card says what a room costs, never
 * whether it is free, and conflating the two is how an agent promises a room
 * that is already sold.
 */
export const name = 'static';

function periodFor(card, date) {
  return card.periods.find((p) => date >= p.from && date <= p.to) ?? null;
}

export async function checkAvailability() {
  return { known: false, reason: 'A rate card carries no availability. Live availability must be confirmed by the owner.' };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function getRate(property, { check_in, check_out, room_type }) {
  const card = property.rate_card;

  // Validate the dates before anything else, so malformed input produces an
  // accurate reason rather than falling through to "check_out is too early".
  for (const [label, v] of [['check_in', check_in], ['check_out', check_out]]) {
    if (!ISO.test(v ?? '') || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      return { known: false, reason: `${label} is not a valid date (expected YYYY-MM-DD, got "${v}").` };
    }
  }
  if (check_out <= check_in) {
    return { known: false, reason: 'check_out must be at least one night after check_in.' };
  }
  const known = property.room_types.map((r) => r.name);
  if (!known.includes(room_type)) {
    return { known: false, reason: `"${room_type}" is not a room type at this property. Room types: ${known.join(', ')}.` };
  }

  // Price each night on its own period, so a stay that straddles the season
  // boundary is quoted correctly rather than at the arrival-night rate.
  const nights = [];
  for (let d = new Date(check_in + 'T00:00:00Z'); d < new Date(check_out + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const period = periodFor(card, iso);
    if (!period) {
      return { known: false, reason: `${iso} falls outside the published season (${property.facts.season ?? 'see property'}).` };
    }
    const nightly = period.rates[room_type];
    if (nightly == null) {
      return { known: false, reason: `No published rate for "${room_type}" on ${iso}.` };
    }
    nights.push({ date: iso, nightly });
  }

  if (!nights.length) {
    return { known: false, reason: 'check_out must be at least one night after check_in.' };
  }

  return {
    known: true,
    currency: card.currency,
    nights: nights.length,
    per_night: nights.map((n) => n.nightly),
    total: nights.reduce((s, n) => s + n.nightly, 0),
    city_tax_note: property.facts.city_tax ?? null,
  };
}
