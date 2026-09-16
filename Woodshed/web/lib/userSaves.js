'use strict';

const crypto = require('crypto');

// --- Password helpers (nullable per-user password, scrypt + per-user salt) ---

function hashPassword(rawPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(rawPassword), salt, 64).toString('hex');
  return { hash, salt };
}

// A save with no hash/salt has no password set (nullable) and is always open.
function verifyPassword(rawPassword, hash, salt) {
  if (!hash || !salt) {
    return true;
  }
  if (!rawPassword) {
    return false;
  }
  const candidate = crypto.scryptSync(String(rawPassword), salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidate, stored);
}

// Resolve what password fields a save should carry after an explicit
// save submission. Throws if the name is already password-protected and
// the submitted password doesn't match. A brand-new (or previously open)
// name adopts whatever password was submitted, including none (nullable).
function resolvePasswordForSave(existingEntry, rawPassword) {
  const existingHash = existingEntry ? existingEntry.passwordHash : null;
  const existingSalt = existingEntry ? existingEntry.passwordSalt : null;
  if (existingHash) {
    if (!verifyPassword(rawPassword, existingHash, existingSalt)) {
      throw new Error('Incorrect password for this user name.');
    }
    return { passwordHash: existingHash, passwordSalt: existingSalt };
  }
  const trimmedPassword = String(rawPassword || '').trim();
  if (trimmedPassword) {
    const { hash, salt } = hashPassword(trimmedPassword);
    return { passwordHash: hash, passwordSalt: salt };
  }
  return { passwordHash: null, passwordSalt: null };
}

// Throws if the requested save is password-protected and the submitted
// password doesn't match. A save with no password set (nullable) loads freely.
function requirePasswordForLoad(existingEntry, rawPassword) {
  if (!existingEntry) {
    return;
  }
  if (!verifyPassword(rawPassword, existingEntry.passwordHash, existingEntry.passwordSalt)) {
    throw new Error('Incorrect password for this user name.');
  }
}

// In-memory fallback store, used when no DATABASE_URL is configured.
// writeUserSaves always receives the FULL saves object and fully replaces
// the store's contents, mirroring how the Postgres-backed store behaves.
function createInMemoryUserSaveStore() {
  const store = {};
  return {
    async readUserSaves() {
      return store;
    },
    async writeUserSaves(saves) {
      // IMPORTANT: readUserSaves() returns the store object by reference, so
      // callers commonly do `const saves = await readUserSaves(); saves[x] = ...;
      // await writeUserSaves(saves);` where `saves` IS `store`. Snapshot the
      // incoming data into a plain copy BEFORE clearing the store, otherwise
      // clearing `store` also empties `saves` (same object) and every save
      // silently vanishes instead of persisting.
      const snapshot = { ...saves };
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      Object.assign(store, snapshot);
    }
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  resolvePasswordForSave,
  requirePasswordForLoad,
  createInMemoryUserSaveStore
};
