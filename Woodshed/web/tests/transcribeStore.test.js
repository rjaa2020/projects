'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLoopId, normalizeLoopRegion, createInMemoryLoopStore } = require('../lib/transcribeStore');

test('createLoopId produces distinct ids', () => {
  const a = createLoopId();
  const b = createLoopId();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test('normalizeLoopRegion accepts a valid region', () => {
  const normalized = normalizeLoopRegion({ name: '  Turnaround bar 9-12  ', startSeconds: 12, endSeconds: 18 });
  assert.equal(normalized.name, 'Turnaround bar 9-12');
  assert.equal(normalized.startSeconds, 12);
  assert.equal(normalized.endSeconds, 18);
});

test('normalizeLoopRegion rejects a missing name', () => {
  assert.throws(() => normalizeLoopRegion({ name: '  ', startSeconds: 0, endSeconds: 5 }), /name/i);
});

test('normalizeLoopRegion rejects non-numeric start/end', () => {
  assert.throws(() => normalizeLoopRegion({ name: 'x', startSeconds: 'a', endSeconds: 5 }), /numbers/i);
});

test('normalizeLoopRegion rejects a negative start', () => {
  assert.throws(() => normalizeLoopRegion({ name: 'x', startSeconds: -1, endSeconds: 5 }), /negative/i);
});

test('normalizeLoopRegion rejects end at or before start', () => {
  assert.throws(() => normalizeLoopRegion({ name: 'x', startSeconds: 10, endSeconds: 10 }), /after loop start/i);
  assert.throws(() => normalizeLoopRegion({ name: 'x', startSeconds: 10, endSeconds: 5 }), /after loop start/i);
});

test('in-memory loop store: save then read round-trips a loop, sorted by start time', async () => {
  const store = createInMemoryLoopStore();
  const videoId = 'abcdefghijk';

  await store.saveLoop(videoId, { name: 'Bridge lick', startSeconds: 60, endSeconds: 70 });
  await store.saveLoop(videoId, { name: 'Turnaround', startSeconds: 10, endSeconds: 20 });

  const loops = await store.readLoops(videoId);
  assert.equal(loops.length, 2);
  assert.equal(loops[0].name, 'Turnaround');
  assert.equal(loops[1].name, 'Bridge lick');
});

test('in-memory loop store: saving with an existing id updates that loop in place', async () => {
  const store = createInMemoryLoopStore();
  const videoId = 'abcdefghijk';

  const saved = await store.saveLoop(videoId, { name: 'Turnaround', startSeconds: 10, endSeconds: 20 });
  await store.saveLoop(videoId, { id: saved.id, name: 'Turnaround (renamed)', startSeconds: 10, endSeconds: 22 });

  const loops = await store.readLoops(videoId);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].name, 'Turnaround (renamed)');
  assert.equal(loops[0].endSeconds, 22);
});

test('in-memory loop store: loops are scoped per video id', async () => {
  const store = createInMemoryLoopStore();

  await store.saveLoop('video-a', { name: 'A lick', startSeconds: 0, endSeconds: 5 });
  await store.saveLoop('video-b', { name: 'B lick', startSeconds: 0, endSeconds: 5 });

  assert.equal((await store.readLoops('video-a')).length, 1);
  assert.equal((await store.readLoops('video-b')).length, 1);
});

test('in-memory loop store: delete removes only the targeted loop', async () => {
  const store = createInMemoryLoopStore();
  const videoId = 'abcdefghijk';

  const first = await store.saveLoop(videoId, { name: 'Keep me', startSeconds: 0, endSeconds: 5 });
  const second = await store.saveLoop(videoId, { name: 'Delete me', startSeconds: 10, endSeconds: 15 });

  await store.deleteLoop(videoId, second.id);

  const loops = await store.readLoops(videoId);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].id, first.id);
});
