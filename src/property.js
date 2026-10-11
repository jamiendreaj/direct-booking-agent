import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'properties');

/**
 * Required fields. A half-filled dossier is the single most likely cause of a
 * wrong answer reaching a guest, so it fails loudly at load rather than
 * degrading quietly at reply time.
 */
const REQUIRED = [
  'id', 'name', 'town', 'languages',
  'contact.owner_name', 'contact.owner_email',
  'booking.direct_url', 'booking.rate_source',
  'room_types', 'facts.check_in', 'facts.cancellation', 'escalate.always',
];

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

export function listProperties() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function loadProperty(id) {
  let raw;
  try {
    raw = readFileSync(join(DIR, `${id}.json`), 'utf8');
  } catch {
    throw new Error(`No property file for "${id}". Available: ${listProperties().join(', ')}`);
  }

  const p = JSON.parse(raw);
  const missing = REQUIRED.filter((k) => {
    const v = get(p, k);
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length) {
    throw new Error(`Property "${id}" is incomplete. Missing: ${missing.join(', ')}`);
  }

  if (p.booking.rate_source === 'static' && !p.rate_card) {
    throw new Error(`Property "${id}" declares rate_source "static" but has no rate_card.`);
  }
  return p;
}
