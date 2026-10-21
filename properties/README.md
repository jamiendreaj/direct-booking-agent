# Property dossiers

One JSON file per hotel. The dossier is the agent's only source of truth: if a
fact is not in here, the agent does not know it and will escalate instead of
guessing.

## What is tracked in git

Only two files:

- `_template.json` — the empty shape, with every field explained
- `example-lakecomo.json` — a fictional property used by the demo and the eval
  suite. Not a real hotel.

**Every other `*.json` in this directory is gitignored.** Real dossiers hold
rates, owner contact details and the house instructions tuned for that
property. That material is commercial-in-confidence and does not belong in a
public repository.

## Adding a property

```bash
cp properties/_template.json properties/my-hotel.json
# fill it in — it will not be committed
npm run reply -- --property my-hotel --enquiry "Do you have parking?"
```

## `prompt_overlay`

An optional free-text field. Whatever you put there is appended to the end of
the system prompt as **house instructions** for that property — the phrasing an
owner prefers, a question that keeps coming up, something that went wrong last
month.

It is appended last so it can sharpen the standing rules. It cannot loosen
them: the three grounding rules and the escalation list are not overridable
from a dossier, by design.

```json
{
  "prompt_overlay": "Guests often ask about arriving from Como. Mention the boat shuttle, and that the last one leaves at 19:40."
}
```

This is where per-client tuning lives precisely because dossiers are private.
The framework is public; what we learned running it for a particular hotel is
not.
