// Pure time-conversion/formatting helpers shared by the Transcribe page's
// client-side script and its Node test suite.
//
// Speed presets are pitch-preserving time-stretches: playing at `speedPercent`
// (e.g. 50) of the original speed makes everything play back in
// (100 / speedPercent) times as long. So a fixed point in the *original*
// (100%-speed) timeline maps to a *local* (currently-loaded file's) timeline
// by multiplying by (100 / speedPercent), and the reverse by multiplying by
// (speedPercent / 100). Saved loops always store original-timeline seconds so
// they stay correct no matter which speed is currently loaded.
//
// UMD wrapper: usable as a plain <script> global (`window.TranscribeTime`) in
// the browser, and via require('./transcribeTime') in Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TranscribeTime = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toOriginalSeconds(localSeconds, speedPercent) {
    return localSeconds * (speedPercent / 100);
  }

  function toLocalSeconds(originalSeconds, speedPercent) {
    return originalSeconds * (100 / speedPercent);
  }

  // Formats a seconds value as "M:SS" (or "H:MM:SS" past one hour).
  // Non-finite or negative input is clamped to "0:00" so a stray NaN/Infinity
  // from an unready player never reaches the screen.
  function formatSeconds(totalSeconds) {
    const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
    const wholeSeconds = Math.round(safeSeconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;

    if (hours > 0) {
      return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  // Formats a start/end pair (in the same timeline) as "M:SS–M:SS (Ns)".
  function formatTimeRange(startSeconds, endSeconds) {
    const safeStart = Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0;
    const safeEnd = Number.isFinite(endSeconds) ? Math.max(0, endSeconds) : 0;
    const durationSeconds = Math.max(0, safeEnd - safeStart);
    return (
      formatSeconds(safeStart) +
      '–' +
      formatSeconds(safeEnd) +
      ' (' +
      durationSeconds.toFixed(1) +
      's)'
    );
  }

  return {
    toOriginalSeconds: toOriginalSeconds,
    toLocalSeconds: toLocalSeconds,
    formatSeconds: formatSeconds,
    formatTimeRange: formatTimeRange
  };
});
