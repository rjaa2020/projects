'use strict';

const crypto = require('crypto');

function createLoopId() {
  return crypto.randomBytes(8).toString('hex');
}

// Throws a plain Error with a user-facing message on invalid input.
function normalizeLoopRegion(raw) {
  const name = String((raw && raw.name) || '').trim().slice(0, 60);
  const startSeconds = Number(raw && raw.startSeconds);
  const endSeconds = Number(raw && raw.endSeconds);

  if (!name) {
    throw new Error('Give this loop a name.');
  }
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new Error('Loop start/end must be numbers.');
  }
  if (startSeconds < 0) {
    throw new Error('Loop start cannot be negative.');
  }
  if (endSeconds <= startSeconds) {
    throw new Error('Loop end must be after loop start.');
  }

  return { name, startSeconds, endSeconds };
}

// In-memory fallback store, used when no DATABASE_URL is configured.
// Mirrors the shape/behavior of createInMemoryUserSaveStore in userSaves.js.
function createInMemoryLoopStore() {
  const store = {}; // videoId -> { [loopId]: loop }

  return {
    async readLoops(videoId) {
      const loops = store[videoId] || {};
      return Object.values(loops).sort((a, b) => a.startSeconds - b.startSeconds);
    },
    async saveLoop(videoId, rawLoop) {
      const normalized = normalizeLoopRegion(rawLoop);
      const id = (rawLoop && rawLoop.id) || createLoopId();
      const updatedAt = new Date().toISOString();
      store[videoId] = store[videoId] || {};
      store[videoId][id] = { id, videoId, ...normalized, updatedAt };
      return store[videoId][id];
    },
    async deleteLoop(videoId, loopId) {
      if (store[videoId]) {
        delete store[videoId][loopId];
      }
    }
  };
}

module.exports = {
  createLoopId,
  normalizeLoopRegion,
  createInMemoryLoopStore
};
