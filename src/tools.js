import * as manual from './adapters/manual.js';
import * as staticCard from './adapters/static.js';

const ADAPTERS = { manual, static: staticCard };

export function adapterFor(property) {
  const a = ADAPTERS[property.booking.rate_source];
  if (!a) throw new Error(`Unknown rate_source "${property.booking.rate_source}". Known: ${Object.keys(ADAPTERS).join(', ')}`);
  return a;
}

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD.' };

export function toolsFor(property) {
  const roomNames = property.room_types.map((r) => r.name);
  return [
    {
      name: 'check_availability',
      description: 'Check whether rooms are free for a date range. Call this before saying anything about availability. Many properties have no connected feed, in which case this returns known:false and you must escalate rather than guess.',
      input_schema: {
        type: 'object',
        properties: { check_in: DATE, check_out: DATE, rooms: { type: 'integer', description: 'Number of rooms wanted.' } },
        required: ['check_in', 'check_out'],
      },
    },
    {
      name: 'get_rate',
      description: 'The only legitimate source of a price. Returns the per-night rates and the total for one room type over a date range. You may not state any price this tool did not return.',
      input_schema: {
        type: 'object',
        properties: {
          check_in: DATE,
          check_out: DATE,
          room_type: { type: 'string', enum: roomNames, description: 'Must be one of the property\'s room types.' },
        },
        required: ['check_in', 'check_out', 'room_type'],
      },
    },
    {
      name: 'send_booking_link',
      description: 'Produce the direct booking link for the guest, pre-filled with their dates where known. Use this rather than writing a URL yourself.',
      input_schema: {
        type: 'object',
        properties: { check_in: DATE, check_out: DATE, room_type: { type: 'string', enum: roomNames } },
        required: [],
      },
    },
    {
      name: 'escalate_to_owner',
      description: 'Hand the enquiry to the hotel. Call this whenever the dossier does not answer the question, availability is unknown, or the enquiry is on the escalation list. Always also tell the guest that a colleague will follow up.',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['unknown_fact', 'availability', 'rate_request', 'group', 'event', 'complaint', 'existing_booking', 'payment_risk', 'unsupported_language', 'other'] },
          summary: { type: 'string', description: 'Two or three sentences for the owner: what the guest wants, and what is needed from them. Written in the owner\'s language.' },
          guest_language: { type: 'string', description: 'ISO code of the language the guest wrote in.' },
        },
        required: ['reason', 'summary'],
      },
    },
  ];
}

export async function runTool(property, name, input, ctx) {
  const adapter = adapterFor(property);

  switch (name) {
    case 'check_availability':
      return adapter.checkAvailability(property, input);

    case 'get_rate':
      return adapter.getRate(property, input);

    case 'send_booking_link': {
      const u = new URL(property.booking.direct_url);
      if (input.check_in) u.searchParams.set('checkin', input.check_in);
      if (input.check_out) u.searchParams.set('checkout', input.check_out);
      if (input.room_type) u.searchParams.set('room', input.room_type);
      return { url: u.toString(), direct_advantage: property.booking.direct_advantage || null };
    }

    case 'escalate_to_owner':
      ctx.escalations.push({ at: new Date().toISOString(), ...input });
      return { delivered: true, to: property.contact.owner_name };

    default:
      return { error: `No such tool: ${name}` };
  }
}
