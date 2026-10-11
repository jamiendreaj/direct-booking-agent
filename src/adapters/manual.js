/**
 * The honest default for a property with no usable PMS read access.
 *
 * It does not guess and it does not fail silently — it tells the agent that
 * live availability is unknown, which the prompt turns into "I'll confirm that
 * with the owner" plus an escalation. That is the behaviour we sell: the agent
 * answers everything it can and hands over the rest.
 */
export const name = 'manual';

export async function checkAvailability() {
  return { known: false, reason: 'This property has no connected availability feed.' };
}

export async function getRate() {
  return { known: false, reason: 'This property has no connected rate feed.' };
}
