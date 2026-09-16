'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hashPassword,
  verifyPassword,
  resolvePasswordForSave,
  requirePasswordForLoad,
  createInMemoryUserSaveStore
} = require('../lib/userSaves');

test('hashPassword produces a verifiable hash/salt pair', () => {
  const { hash, salt } = hashPassword('sax-and-jazz');
  assert.ok(hash.length > 0);
  assert.ok(salt.length > 0);
  assert.equal(verifyPassword('sax-and-jazz', hash, salt), true);
  assert.equal(verifyPassword('wrong-password', hash, salt), false);
});

test('hashPassword salts each call differently, even for the same password', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('verifyPassword treats a save with no hash/salt as open (nullable password)', () => {
  assert.equal(verifyPassword('', null, null), true);
  assert.equal(verifyPassword('anything', null, null), true);
  assert.equal(verifyPassword(undefined, undefined, undefined), true);
});

test('resolvePasswordForSave: brand-new name with no password stays nullable', () => {
  const resolved = resolvePasswordForSave(null, '');
  assert.equal(resolved.passwordHash, null);
  assert.equal(resolved.passwordSalt, null);
});

test('resolvePasswordForSave: brand-new name adopts a submitted password', () => {
  const resolved = resolvePasswordForSave(null, 'my-secret');
  assert.ok(resolved.passwordHash);
  assert.ok(resolved.passwordSalt);
  assert.equal(verifyPassword('my-secret', resolved.passwordHash, resolved.passwordSalt), true);
});

test('resolvePasswordForSave: previously-open name can adopt a password on a later save', () => {
  const existing = { passwordHash: null, passwordSalt: null };
  const resolved = resolvePasswordForSave(existing, 'new-secret');
  assert.ok(resolved.passwordHash);
  assert.equal(verifyPassword('new-secret', resolved.passwordHash, resolved.passwordSalt), true);
});

test('resolvePasswordForSave: protected name requires the matching password to re-save', () => {
  const { hash, salt } = hashPassword('correct-horse');
  const existing = { passwordHash: hash, passwordSalt: salt };

  const resolved = resolvePasswordForSave(existing, 'correct-horse');
  assert.equal(resolved.passwordHash, hash);
  assert.equal(resolved.passwordSalt, salt);

  assert.throws(
    () => resolvePasswordForSave(existing, 'wrong-guess'),
    /Incorrect password/
  );
});

test('requirePasswordForLoad: no existing save never blocks (a fresh name)', () => {
  assert.doesNotThrow(() => requirePasswordForLoad(null, 'whatever'));
});

test('requirePasswordForLoad: an open save (nullable password) loads with any input', () => {
  const existing = { passwordHash: null, passwordSalt: null };
  assert.doesNotThrow(() => requirePasswordForLoad(existing, ''));
  assert.doesNotThrow(() => requirePasswordForLoad(existing, 'ignored'));
});

test('requirePasswordForLoad: a protected save blocks the wrong password and allows the right one', () => {
  const { hash, salt } = hashPassword('woodshed123');
  const existing = { passwordHash: hash, passwordSalt: salt };

  assert.throws(() => requirePasswordForLoad(existing, 'nope'), /Incorrect password/);
  assert.throws(() => requirePasswordForLoad(existing, ''), /Incorrect password/);
  assert.doesNotThrow(() => requirePasswordForLoad(existing, 'woodshed123'));
});

test('in-memory store: saving then reloading a profile round-trips its state', async () => {
  const store = createInMemoryUserSaveStore();

  const saves = await store.readUserSaves();
  assert.deepEqual(saves, {});

  saves.rahul = {
    updatedAt: '2026-09-16T00:00:00.000Z',
    state: { score: 42, round: 5 },
    passwordHash: null,
    passwordSalt: null
  };
  await store.writeUserSaves(saves);

  const reloaded = await store.readUserSaves();
  assert.equal(reloaded.rahul.state.score, 42);
  assert.equal(reloaded.rahul.state.round, 5);
});

test('in-memory store: a full write replaces prior contents (no stale entries survive)', async () => {
  const store = createInMemoryUserSaveStore();

  const first = await store.readUserSaves();
  first.alice = { updatedAt: 't1', state: { score: 1 }, passwordHash: null, passwordSalt: null };
  await store.writeUserSaves(first);

  // Simulate a second save cycle: read, add a second user, write the full set.
  const second = await store.readUserSaves();
  second.bob = { updatedAt: 't2', state: { score: 2 }, passwordHash: null, passwordSalt: null };
  await store.writeUserSaves(second);

  const final = await store.readUserSaves();
  assert.ok(final.alice, 'earlier save should still be present after a later save');
  assert.ok(final.bob, 'new save should be present');
  assert.equal(Object.keys(final).length, 2);
});

test('in-memory store: password protection survives a save/reload round trip end to end', async () => {
  const store = createInMemoryUserSaveStore();

  const saves = await store.readUserSaves();
  const resolved = resolvePasswordForSave(saves.practiceLog, 'shhh');
  saves.practiceLog = {
    updatedAt: '2026-09-16T00:00:00.000Z',
    state: { score: 7 },
    passwordHash: resolved.passwordHash,
    passwordSalt: resolved.passwordSalt
  };
  await store.writeUserSaves(saves);

  const reloaded = await store.readUserSaves();
  assert.throws(() => requirePasswordForLoad(reloaded.practiceLog, 'wrong'), /Incorrect password/);
  assert.doesNotThrow(() => requirePasswordForLoad(reloaded.practiceLog, 'shhh'));
});
