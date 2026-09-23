'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toOriginalSeconds,
  toLocalSeconds,
  formatSeconds,
  formatTimeRange
} = require('../public/transcribeTime');

test('toOriginalSeconds scales a local-timeline value down to the original timeline', () => {
  // At 50% speed, 1 local second corresponds to 0.5 original seconds.
  assert.equal(toOriginalSeconds(10, 50), 5);
  // At 100% speed, local and original seconds are identical.
  assert.equal(toOriginalSeconds(10, 100), 10);
});

test('toLocalSeconds scales an original-timeline value up to the local timeline', () => {
  // At 50% speed, 5 original seconds take 10 local (slowed-down) seconds to play.
  assert.equal(toLocalSeconds(5, 50), 10);
  assert.equal(toLocalSeconds(10, 100), 10);
});

test('toOriginalSeconds and toLocalSeconds are inverses of each other', () => {
  for (const speed of [100, 90, 80, 70, 60, 50]) {
    const original = 37.4;
    const roundTripped = toOriginalSeconds(toLocalSeconds(original, speed), speed);
    assert.ok(Math.abs(roundTripped - original) < 1e-9, `speed ${speed} did not round-trip`);
  }
});

test('formatSeconds pads seconds and formats minutes:seconds', () => {
  assert.equal(formatSeconds(0), '0:00');
  assert.equal(formatSeconds(5), '0:05');
  assert.equal(formatSeconds(65), '1:05');
  assert.equal(formatSeconds(599), '9:59');
});

test('formatSeconds expands to hours:minutes:seconds past one hour', () => {
  assert.equal(formatSeconds(3600), '1:00:00');
  assert.equal(formatSeconds(3725), '1:02:05');
});

test('formatSeconds rounds to the nearest whole second', () => {
  assert.equal(formatSeconds(59.6), '1:00');
  assert.equal(formatSeconds(59.4), '0:59');
});

test('formatSeconds clamps negative, NaN, and Infinity to 0:00', () => {
  assert.equal(formatSeconds(-5), '0:00');
  assert.equal(formatSeconds(NaN), '0:00');
  assert.equal(formatSeconds(Infinity), '0:00');
});

test('formatTimeRange shows start, end, and duration', () => {
  assert.equal(formatTimeRange(65, 70.5), '1:05–1:11 (5.5s)');
});

test('formatTimeRange clamps an end before start to a zero-length duration', () => {
  assert.equal(formatTimeRange(10, 4), '0:10–0:04 (0.0s)');
});
