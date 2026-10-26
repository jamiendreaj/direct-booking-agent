/**
 * Tests for the output guardrails.
 *
 * These are the checks that stand between a model and a guest, so they are the
 * part of this system most worth testing. Every case below is a failure the
 * agent could plausibly produce: a price nobody authorised, a booking confirmed
 * that was never held, a reply in the wrong language.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from './guardrails.js';

/** A dossier trimmed to the only part guardrails reads. */
const property = {
  facts: {
    parking: '14 private spaces at €18 a night',
    city_tax: 'City tax is €3 per person per night',
    pets: 'Dogs welcome, no charge',
  },
};

const base = { toolResults: [], property, expectLanguage: null };
const blocked = (r) => r.issues.filter((i) => i.severity === 'block').map((i) => i.rule);
const warned = (r) => r.issues.filter((i) => i.severity === 'warn').map((i) => i.rule);

test('a clean reply passes', () => {
  const r = check(
    'The Superior Lago sleeps two and has a French balcony facing the lake. ' +
      'You can book it on our own site at https://example.invalid/booking.',
    base,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('blocks a price no tool returned', () => {
  const r = check('The Superior Lago is €240 a night.', base);
  assert.equal(r.ok, false);
  assert.deepEqual(blocked(r), ['unauthorised_price']);
});

test('allows a price a tool did return', () => {
  const r = check('The Superior Lago is €240 a night.', {
    ...base,
    toolResults: [{ known: true, nightly: 240, currency: 'EUR' }],
  });
  assert.equal(r.ok, true);
});

test('allows a fixed fee stated in the dossier', () => {
  // Parking at €18 is in property.facts, so the agent may quote it.
  const r = check('Parking is €18 a night and does need reserving.', base);
  assert.equal(r.ok, true);
});

test('finds a price inside a nested tool result', () => {
  const r = check('Three nights come to €720.', {
    ...base,
    toolResults: [{ quote: { stay: { total: 720 } } }],
  });
  assert.equal(r.ok, true);
});

test('reads European decimal formatting', () => {
  // "€1.234,56" is one thousand two hundred, not one point two three.
  const r = check('The total is €1.234,56 for the week.', {
    ...base,
    toolResults: [{ total: 1234.56 }],
  });
  assert.equal(r.ok, true);
});

test('catches a price written after the symbol-less number', () => {
  const r = check('That would be 395 euro for the two nights.', base);
  assert.deepEqual(blocked(r), ['unauthorised_price']);
});

test('blocks a confirmed booking in English', () => {
  const r = check('I have confirmed the Superior Lago for you.', base);
  assert.deepEqual(blocked(r), ['confirmed_booking']);
});

test('blocks a confirmed booking in Italian', () => {
  const r = check('Abbiamo prenotato la camera per lei.', base);
  assert.deepEqual(blocked(r), ['confirmed_booking']);
});

test('blocks a confirmed booking in German', () => {
  const r = check('Ihr Zimmer ist reserviert.', base);
  assert.deepEqual(blocked(r), ['confirmed_booking']);
});

test('reports a confirmation only once, however many patterns match', () => {
  const r = check('I have booked it. Your reservation is confirmed.', base);
  assert.equal(blocked(r).filter((x) => x === 'confirmed_booking').length, 1);
});

test('blocks any mention of card or bank details', () => {
  for (const line of [
    'Please send your card number by reply.',
    'Ci invii il numero di carta.',
    'Bitte senden Sie Ihre Kreditkartennummer.',
    'You can transfer to our IBAN.',
  ]) {
    assert.equal(check(line, base).ok, false, line);
  }
});

test('blocks an Italian reply to a guest who did not write in Italian', () => {
  const r = check(
    'Gentile ospite, la camera è disponibile. Cordiali saluti.',
    { ...base, expectLanguage: 'de' },
  );
  assert.ok(blocked(r).includes('wrong_language'));
});

test('allows an Italian reply to an Italian guest', () => {
  const r = check(
    'Gentile ospite, la colazione è inclusa. Cordiali saluti.',
    { ...base, expectLanguage: 'it' },
  );
  assert.equal(r.ok, true);
});

test('skips the language check when no language is expected', () => {
  const r = check('Gentile ospite, cordiali saluti.', base);
  assert.equal(r.ok, true);
});

test('warns on hedging without blocking the reply', () => {
  const r = check('Breakfast usually runs until 10:00.', base);
  assert.equal(r.ok, true, 'a hedge is a warning, not a block');
  assert.deepEqual(warned(r), ['hedged_fact']);
});

test('reports every distinct problem in one pass', () => {
  const r = check('I have confirmed it at €240. Send your card number.', base);
  const rules = blocked(r);
  assert.ok(rules.includes('unauthorised_price'));
  assert.ok(rules.includes('confirmed_booking'));
  assert.ok(rules.includes('payment_detail'));
});

test('an empty reply is not blocked here — sendability is the agent\'s call', () => {
  // check() only judges content. agent.js separately requires text.length > 0,
  // so an empty draft can never be sent even though it has no issues.
  const r = check('', base);
  assert.equal(r.ok, true);
});

test('a year is not mistaken for a price', () => {
  const r = check('The villa was built in 1890 and restored in 2019.', base);
  assert.deepEqual(blocked(r), [], 'bare numbers without a currency are not prices');
});

/* ── Chinese, Russian and Arabic ──────────────────────────────────────────
 *
 * Added when the supported languages grew. Worth their own block because the
 * first version of the Russian patterns used \b and silently never matched:
 * JavaScript's \w is ASCII-only, so there is no word boundary beside a
 * Cyrillic letter. The regex compiled, the tests would have passed if written
 * loosely, and a confirmed booking in Russian would have gone to a guest.
 */

test('blocks a confirmed booking in Chinese', () => {
  for (const line of [
    '您的房间已确认，期待您的到来。',
    '我们为您保留了湖景房。',
    '您的房間已確認。',
  ]) {
    assert.deepEqual(blocked(check(line, base)), ['confirmed_booking'], line);
  }
});

test('blocks a confirmed booking in Russian', () => {
  for (const line of [
    'Я забронировал для вас номер.',
    'Подтверждаю бронирование.',
    'Номер зарезервирован на ваше имя.',
  ]) {
    assert.deepEqual(blocked(check(line, base)), ['confirmed_booking'], line);
  }
});

test('blocks a confirmed booking in Arabic', () => {
  for (const line of [
    'تم تأكيد حجزك.',
    'حجزت لك غرفة مطلة على البحيرة.',
    'غرفتك محجوزة.',
  ]) {
    assert.deepEqual(blocked(check(line, base)), ['confirmed_booking'], line);
  }
});

test('blocks a confirmed booking in Hebrew', () => {
  for (const line of [
    'אישרתי עבורך את החדר.',
    'ההזמנה שלך אושרה.',
    'הזמנתי לך חדר עם נוף לאגם.',
  ]) {
    assert.deepEqual(blocked(check(line, base)), ['confirmed_booking'], line);
  }
});

test('Hebrew card patterns survive the definite article', () => {
  // Hebrew prefixes ה onto the noun: הכרטיס, not ה כרטיס. The first version of
  // this pattern wanted a bare כרטיס and matched nothing in a real sentence.
  for (const line of [
    'נא לשלוח את מספר הכרטיס.',
    'אפשר לשלוח מספר כרטיס אשראי?',
    'מה מספר החשבון שלך?',
  ]) {
    assert.equal(check(line, base).ok, false, line);
  }
});

test('blocks card details in Chinese, Russian and Arabic', () => {
  for (const line of [
    '请发送您的卡号。',
    'Пришлите номер карты.',
    'يرجى إرسال رقم البطاقة.',
  ]) {
    assert.equal(check(line, base).ok, false, line);
  }
});

test('a reply in the wrong script is blocked', () => {
  // The failure that actually happens: the model answers a Cyrillic enquiry in
  // English, because English is where it is most comfortable.
  const english = 'Yes, the room sleeps four and the dog is welcome.';
  for (const lang of ['ru', 'zh', 'ar', 'he']) {
    const r = check(english, { ...base, expectLanguage: lang });
    assert.ok(blocked(r).includes('wrong_language'), `${lang} should have been blocked`);
  }
});

test('a reply in the right script passes', () => {
  const ok = [
    ['ru', 'Да, номер вмещает четырёх человек, и собака тоже может приехать.'],
    ['zh', '是的，这间房可住四人，也欢迎携带宠物犬。'],
    ['ar', 'نعم، تتسع الغرفة لأربعة أشخاص، والكلب مرحب به أيضًا.'],
    ['he', 'כן, החדר מתאים לארבעה אנשים, וגם הכלב מוזמן.'],
  ];
  for (const [lang, reply] of ok) {
    assert.equal(check(reply, { ...base, expectLanguage: lang }).ok, true, lang);
  }
});

test('the script check does not fire on an empty draft', () => {
  // An empty reply is the agent's problem to report, not a language failure.
  const r = check('', { ...base, expectLanguage: 'ru' });
  assert.equal(blocked(r).includes('wrong_language'), false);
});

test('Cyrillic patterns do not rely on word boundaries', () => {
  // Guards the exact bug: \b beside a Cyrillic letter never matches in JS.
  assert.equal(/\b(?:забронирова)/i.test('Я забронировал номер'), false,
    'if this ever becomes true, JS changed and the comment above is stale');
  assert.deepEqual(blocked(check('Я забронировал номер', base)), ['confirmed_booking']);
});
