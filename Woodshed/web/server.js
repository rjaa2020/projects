const express = require('express');
const session = require('express-session');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const { Pool } = require('pg');
const PgSessionStore = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.WOODSHED_API_URL || 'http://127.0.0.1:8000';
const USER_SAVE_FILE = path.join(__dirname, 'data', 'user-saves.json');
const INSTRUMENT_KEYS = ['C', 'Bb', 'Eb'];
const PRACTICE_ROOT_ORDER = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// When DATABASE_URL is set, practice sessions and named saves persist in
// Postgres and survive restarts/redeploys. Without it, everything falls
// back to in-memory storage (fine for local dev, resets on restart).
const DATABASE_URL = process.env.DATABASE_URL || '';
const pgPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    })
  : null;

async function ensureUserSavesTable() {
  if (!pgPool) {
    return;
  }
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_saves (
      name TEXT PRIMARY KEY,
      updated_at TIMESTAMPTZ NOT NULL,
      state JSONB NOT NULL
    )
  `);
}

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: pgPool
      ? new PgSessionStore({ pool: pgPool, tableName: 'session', createTableIfMissing: true })
      : undefined,
    secret: process.env.WOODSHED_SESSION_SECRET || 'woodshed-dev-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 4 }
  })
);
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

async function callApi(pathname, payload) {
  const method = payload ? 'POST' : 'GET';
  const requestOptions = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (payload) {
    requestOptions.body = JSON.stringify(payload);
  }

  const response = await fetch(`${API_BASE_URL}${pathname}`, requestOptions);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${pathname} failed (${response.status}): ${text}`);
  }

  return response.json();
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeSelections(values) {
  return Array.from(new Set(values));
}

function mergePreferences(body, existingPreferences, options) {
  const includeKeys = normalizeSelections(toArray(body.includeKeys));
  const includeChordQualities = normalizeSelections(toArray(body.includeChordQualities));
  const requestedInstrument = String(body.instrumentKey || '').trim();
  const instrumentKey = INSTRUMENT_KEYS.includes(requestedInstrument)
    ? requestedInstrument
    : (existingPreferences && INSTRUMENT_KEYS.includes(existingPreferences.instrumentKey) ? existingPreferences.instrumentKey : 'C');

  return {
    ...(existingPreferences || {}),
    includeKeys: includeKeys.filter((item) => options.keys.includes(item)),
    includeChordQualities: includeChordQualities.filter((item) => options.chord_qualities.includes(item)),
    instrumentKey
  };
}

function defaultPreferences(options) {
  return {
    includeKeys: [...options.keys],
    includeChordQualities: [...options.chord_qualities],
    instrumentKey: 'C',
    chartQuiz: null
  };
}

function coerceInstrumentKey(rawInstrumentKey) {
  const key = String(rawInstrumentKey || '').trim();
  return INSTRUMENT_KEYS.includes(key) ? key : 'C';
}

function coerceChartQuiz(rawChartQuiz) {
  const chart = plainObject(rawChartQuiz);
  if (typeof chart.title !== 'string' || !chart.title.trim()) {
    return null;
  }

  const chords = Array.isArray(chart.chords)
    ? chart.chords.filter((item) => typeof item === 'string' && item.trim())
    : [];

  if (!chords.length) {
    return null;
  }

  return {
    title: chart.title.trim(),
    chords
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeUserName(value) {
  return String(value || '').trim().slice(0, 40);
}

// In-memory fallback for named saves, used only when DATABASE_URL isn't set.
const IN_MEMORY_USER_SAVES = {};

async function readUserSaves() {
  if (!pgPool) {
    return IN_MEMORY_USER_SAVES;
  }
  const { rows } = await pgPool.query('SELECT name, updated_at, state FROM user_saves');
  const saves = {};
  for (const row of rows) {
    saves[row.name] = { updatedAt: row.updated_at.toISOString(), state: row.state };
  }
  return saves;
}

async function writeUserSaves(saves) {
  if (!pgPool) {
    for (const key of Object.keys(IN_MEMORY_USER_SAVES)) {
      delete IN_MEMORY_USER_SAVES[key];
    }
    Object.assign(IN_MEMORY_USER_SAVES, saves);
    return;
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_saves');
    for (const [name, entry] of Object.entries(saves)) {
      await client.query(
        'INSERT INTO user_saves (name, updated_at, state) VALUES ($1, $2, $3)',
        [name, entry.updatedAt, entry.state]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isValidPrompt(prompt) {
  return Boolean(
    prompt
    && typeof prompt.symbol === 'string'
    && Array.isArray(prompt.notes)
    && prompt.notes.length === 4
  );
}

function coercePreferences(rawPreferences, options) {
  const defaults = defaultPreferences(options);
  const raw = plainObject(rawPreferences);

  const includeKeys = Array.isArray(raw.includeKeys)
    ? raw.includeKeys.filter((item) => options.keys.includes(item))
    : [];
  const includeChordQualities = Array.isArray(raw.includeChordQualities)
    ? raw.includeChordQualities.filter((item) => options.chord_qualities.includes(item))
    : [];

  return {
    includeKeys: includeKeys.length ? includeKeys : defaults.includeKeys,
    includeChordQualities: includeChordQualities.length ? includeChordQualities : defaults.includeChordQualities,
    instrumentKey: coerceInstrumentKey(raw.instrumentKey),
    scores: plainObject(raw.scores),
    attemptTimes: plainObject(raw.attemptTimes),
    chartQuiz: coerceChartQuiz(raw.chartQuiz)
  };
}

function ensureSessionPreferences(req, options) {
  const preferences = coercePreferences(req.session.preferences, options);
  req.session.preferences = preferences;
  return preferences;
}

function applySavedStateToSession(req, options, savedState) {
  const state = plainObject(savedState);
  req.session.preferences = coercePreferences(state.preferences, options);
  req.session.score = Number.isInteger(state.score) && state.score >= 0 ? state.score : 0;
  req.session.round = Number.isInteger(state.round) && state.round >= 1 ? state.round : 1;

  const selectedStat = plainObject(state.selectedStat);
  req.session.selectedStat = (
    typeof selectedStat.root === 'string'
    && typeof selectedStat.quality === 'string'
    && options.keys.includes(selectedStat.root)
    && options.chord_qualities.includes(selectedStat.quality)
  ) ? { root: selectedStat.root, quality: selectedStat.quality } : null;

  const overall = Number(state.overallElapsedSeconds);
  req.session.overallElapsedSeconds = Number.isFinite(overall) && overall >= 0 ? overall : 0;

  req.session.prompt = isValidPrompt(state.prompt) ? state.prompt : null;
  req.session.promptStartedAtMs = Date.now();
}

function snapshotSessionState(req) {
  return {
    preferences: req.session.preferences || {},
    score: Number.isInteger(req.session.score) ? req.session.score : 0,
    round: Number.isInteger(req.session.round) ? req.session.round : 1,
    selectedStat: req.session.selectedStat || null,
    overallElapsedSeconds: Number.isFinite(Number(req.session.overallElapsedSeconds))
      ? Number(req.session.overallElapsedSeconds)
      : 0,
    prompt: isValidPrompt(req.session.prompt) ? req.session.prompt : null
  };
}

async function persistActiveUserState(req) {
  const activeUser = normalizeUserName(req.session.activeUser);
  if (!activeUser) {
    return;
  }

  const saves = await readUserSaves();
  saves[activeUser] = {
    updatedAt: new Date().toISOString(),
    state: snapshotSessionState(req)
  };
  await writeUserSaves(saves);
}

async function listSavedUserNames() {
  const saves = await readUserSaves();
  return Object.keys(saves)
    .map((name) => normalizeUserName(name))
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function parsePortFromUrl(urlString, fallbackPort) {
  try {
    const parsed = new URL(urlString);
    const parsedPort = Number(parsed.port);
    if (Number.isFinite(parsedPort) && parsedPort > 0) {
      return parsedPort;
    }
  } catch {
  }

  return fallbackPort;
}

function checkboxGrid(name, items, selectedItems, labelFormatter = (value) => String(value)) {
  const selected = new Set(selectedItems);
  return items
    .map(
      (item) => `<label class="check-item"><input type="checkbox" name="${name}" value="${escapeHtml(item)}" ${selected.has(item) ? 'checked' : ''} /> ${escapeHtml(labelFormatter(item))}</label>`
    )
    .join('');
}

const CIRCLE_OF_FIFTHS_ORDER = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const RELATIVE_MINOR_BY_MAJOR = {
  C: 'A',
  G: 'E',
  D: 'B',
  A: 'F#',
  E: 'C#',
  B: 'G#',
  Gb: 'Eb',
  Db: 'Bb',
  Ab: 'F',
  Eb: 'C',
  Bb: 'G',
  F: 'D'
};

function keyInputId(key) {
  return `includeKey-${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function formatAccidentalHtml(noteLabel) {
  const normalized = String(noteLabel || '').trim();
  if (!normalized) {
    return '';
  }

  const letter = normalized.charAt(0).toUpperCase();
  const accidental = normalized.slice(1)
    .replace(/b/g, '♭')
    .replace(/#/g, '♯');
  if (!accidental) {
    return escapeHtml(letter);
  }

  return `${escapeHtml(letter)}<span class="note-accidental">${escapeHtml(accidental)}</span>`;
}

function renderCircleOfFifths(options, selectedKeys) {
  const selected = new Set(selectedKeys);
  const ordered = CIRCLE_OF_FIFTHS_ORDER
    .filter((key) => options.keys.includes(key))
    .concat(options.keys.filter((key) => !CIRCLE_OF_FIFTHS_ORDER.includes(key)));

  const spokes = ordered
    .map((_, index) => {
      const angle = ((index / ordered.length) * Math.PI * 2) - (Math.PI / 2);
      const x1 = 50 + (Math.cos(angle) * 17.5);
      const y1 = 50 + (Math.sin(angle) * 17.5);
      const x2 = 50 + (Math.cos(angle) * 48.5);
      const y2 = 50 + (Math.sin(angle) * 48.5);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`;
    })
    .join('');

  const keyButtons = ordered
    .map((key, index) => {
      const angle = ((((index + 0.5) / ordered.length) * Math.PI * 2) - (Math.PI / 2));
      const x = 50 + (Math.cos(angle) * 39.5);
      const y = 50 + (Math.sin(angle) * 39.5);
      const selectedClass = selected.has(key) ? ' selected' : '';
      const inputId = keyInputId(key);
      const labelHtml = formatAccidentalHtml(formatDisplayNote(key));
      const labelText = formatDisplayNote(key);
      return `<button type="button" class="fifths-key${selectedClass}" data-key="${escapeHtml(key)}" data-input-id="${escapeHtml(inputId)}" aria-label="${escapeHtml(labelText)}" style="--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%">${labelHtml}</button>`;
    })
    .join('');

  const minorLabels = ordered
    .map((key, index) => {
      const minorRoot = RELATIVE_MINOR_BY_MAJOR[key] || 'A';
      const angle = ((((index + 0.5) / ordered.length) * Math.PI * 2) - (Math.PI / 2));
      const x = 50 + (Math.cos(angle) * 22.5);
      const y = 50 + (Math.sin(angle) * 22.5);
      return `<span class="fifths-minor" style="--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%">${formatAccidentalHtml(minorRoot)}<span class="minor-suffix">m</span></span>`;
    })
    .join('');

  const hiddenInputs = options.keys
    .map((key) => {
      const inputId = keyInputId(key);
      return `<input class="key-selection-input" id="${escapeHtml(inputId)}" type="checkbox" name="includeKeys" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''} hidden />`;
    })
    .join('');

  return `<div class="fifths-wrap" aria-label="Circle of fifths key selector">
      <div class="fifths-circle">
        <svg class="fifths-guides" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle cx="50" cy="50" r="49" />
          <circle cx="50" cy="50" r="30" />
          <circle cx="50" cy="50" r="17.5" />
          ${spokes}
        </svg>
        ${keyButtons}
        ${minorLabels}
        <div class="fifths-center" aria-hidden="true"></div>
      </div>
      <div class="sr-only">${hiddenInputs}</div>
    </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenizeNotes(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNote(value) {
  return String(value || '')
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/𝄪/g, '##')
    .replace(/𝄫/g, 'bb')
    .toUpperCase();
}

const NATURAL_NOTE_PITCH = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

function notePitchClass(note) {
  const normalized = normalizeNote(note);
  const match = normalized.match(/^([A-G])([#BX]*)$/);
  if (!match) {
    return null;
  }

  const base = NATURAL_NOTE_PITCH[match[1]];
  if (!Number.isFinite(base)) {
    return null;
  }

  const accidentalText = match[2] || '';
  let accidentalDelta = 0;
  for (const accidental of accidentalText) {
    if (accidental === '#') {
      accidentalDelta += 1;
    } else if (accidental === 'B') {
      accidentalDelta -= 1;
    } else if (accidental === 'X') {
      accidentalDelta += 2;
    } else {
      return null;
    }
  }

  return ((base + accidentalDelta) % 12 + 12) % 12;
}

function noteOrderRank(note) {
  const pitchClass = notePitchClass(note);
  if (Number.isFinite(pitchClass)) {
    return pitchClass;
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortNotesWithClasses(notes, classes, rootPitch = null) {
  const hasRootPitch = Number.isFinite(rootPitch) && rootPitch >= 0 && rootPitch <= 11;
  const relativeRank = (note) => {
    const absoluteRank = noteOrderRank(note);
    if (absoluteRank === Number.MAX_SAFE_INTEGER) {
      return absoluteRank;
    }
    if (!hasRootPitch) {
      return absoluteRank;
    }
    return (absoluteRank - rootPitch + 12) % 12;
  };

  const paired = notes.map((note, index) => ({ note, className: classes[index], index }));
  paired.sort((a, b) => {
    const rankDiff = relativeRank(a.note) - relativeRank(b.note);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    const normalizedDiff = normalizeNote(a.note).localeCompare(normalizeNote(b.note));
    if (normalizedDiff !== 0) {
      return normalizedDiff;
    }

    return a.index - b.index;
  });

  return {
    notes: paired.map((item) => item.note),
    classes: paired.map((item) => item.className)
  };
}

function formatDisplayNote(note) {
  const normalized = normalizeNote(note);
  if (!normalized) {
    return '';
  }

  const tonic = normalized.charAt(0);
  const accidental = normalized.slice(1).replace(/B/g, 'b');
  return `${tonic}${accidental}`;
}

function formatDisplayNotesList(notes) {
  const formatted = (Array.isArray(notes) ? notes : [])
    .map((note) => formatDisplayNote(note))
    .filter(Boolean);
  return formatted.length ? formatted.join(', ') : '—';
}

function formatDisplayChordSymbol(root, quality) {
  return `${formatDisplayNote(root)}${String(quality || '').trim()}`;
}

function noteCountMap(notes) {
  const counts = new Map();
  notes.forEach((note) => {
    const pitchClass = notePitchClass(note);
    if (!Number.isFinite(pitchClass)) {
      return;
    }
    counts.set(pitchClass, (counts.get(pitchClass) || 0) + 1);
  });
  return counts;
}

function renderNoteChips(notes, classes) {
  if (!notes.length) {
    return '<span class="note-chip note-empty">—</span>';
  }

  return notes
    .map((note, index) => `<span class="note-chip ${classes[index]}">${escapeHtml(formatDisplayNote(note))}</span>`)
    .join(' ');
}

function renderIncorrectAnswerMessage(promptSymbol, userAnswer, correctNotes) {
  const userNotes = tokenizeNotes(userAnswer);
  const promptRootPitch = rootPitchClass({ symbol: promptSymbol, notes: correctNotes });
  const normalizedCorrectCounts = noteCountMap(correctNotes);
  const matchedCounts = new Map();

  const userClasses = userNotes.map((note) => {
    const pitchClass = notePitchClass(note);
    const available = Number.isFinite(pitchClass)
      ? (normalizedCorrectCounts.get(pitchClass) || 0)
      : 0;
    if (available > 0) {
      normalizedCorrectCounts.set(pitchClass, available - 1);
      matchedCounts.set(pitchClass, (matchedCounts.get(pitchClass) || 0) + 1);
      return 'note-match';
    }
    return 'note-extra';
  });

  const correctClasses = correctNotes.map((note) => {
    const pitchClass = notePitchClass(note);
    const matched = Number.isFinite(pitchClass)
      ? (matchedCounts.get(pitchClass) || 0)
      : 0;
    if (matched > 0) {
      matchedCounts.set(pitchClass, matched - 1);
      return 'note-match';
    }
    return 'note-missing';
  });

  const sortedUser = sortNotesWithClasses(userNotes, userClasses, promptRootPitch);
  const sortedCorrect = sortNotesWithClasses(correctNotes, correctClasses, promptRootPitch);
  const userChips = renderNoteChips(sortedUser.notes, sortedUser.classes);
  const correctChips = renderNoteChips(sortedCorrect.notes, sortedCorrect.classes);

  return `<div><strong>Not quite.</strong> ${escapeHtml(promptSymbol)} note comparison:</div>
    <div class="answer-diff">
      <div class="diff-row"><span class="diff-label">Your input</span>${userChips}</div>
      <div class="diff-row"><span class="diff-label">Correct</span>${correctChips}</div>
    </div>`;
}

function buildPromptPayload(preferences) {
  const chartQuiz = coerceChartQuiz(preferences.chartQuiz);
  const instrumentKey = coerceInstrumentKey(preferences.instrumentKey);
  return {
    include_keys: preferences.includeKeys,
    include_chord_qualities: preferences.includeChordQualities,
    exclude_keys: [],
    exclude_chord_qualities: [],
    scores: preferences.scores,
    chart_chords: chartQuiz ? chartQuiz.chords : [],
    instrument_key: instrumentKey
  };
}

function chartAvailableComboSet(preferences) {
  const chartQuiz = coerceChartQuiz(preferences && preferences.chartQuiz);
  if (!chartQuiz) {
    return null;
  }

  const instrumentKey = coerceInstrumentKey(preferences && preferences.instrumentKey);
  const semitoneOffsetByInstrument = { C: 0, Bb: 2, Eb: 9 };
  const semitoneOffset = semitoneOffsetByInstrument[instrumentKey] || 0;
  const rootIndexByName = Object.fromEntries(PRACTICE_ROOT_ORDER.map((root, index) => [root, index]));
  const available = new Set();

  chartQuiz.chords.forEach((symbol) => {
    const match = String(symbol || '').trim().match(/^([A-G][#b]?)(.+)$/);
    if (!match) {
      return;
    }

    const root = match[1];
    const quality = match[2];
    const rootIndex = rootIndexByName[root];
    if (!Number.isInteger(rootIndex)) {
      return;
    }

    const shiftedRoot = PRACTICE_ROOT_ORDER[(rootIndex + semitoneOffset) % PRACTICE_ROOT_ORDER.length];
    available.add(`${shiftedRoot}|${quality}`);
  });

  return available;
}

function resetScores(preferences) {
  return {
    ...preferences,
    scores: {},
    attemptTimes: {}
  };
}

function scoreKey(root, quality) {
  return `${root}|${quality}`;
}

function scoreValue(scores, root, quality) {
  return Number(scores[scoreKey(root, quality)] || 0);
}

function attemptsFor(attemptTimes, root, quality) {
  const byRoot = attemptTimes[root];
  if (!byRoot || typeof byRoot !== 'object') {
    return [];
  }

  const values = byRoot[quality];
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function averageAttemptTime(attemptTimes, root, quality) {
  const values = attemptsFor(attemptTimes, root, quality);
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function averageAttemptTimeMatrix(keys, chordQualities, attemptTimes) {
  return Object.fromEntries(
    keys.map((root) => [
      root,
      Object.fromEntries(
        chordQualities.map((quality) => {
          const average = averageAttemptTime(attemptTimes, root, quality);
          return [quality, average];
        })
      )
    ])
  );
}

function buildTimeSeriesPath(values, width, height, padding) {
  if (!values.length) {
    return '';
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = maxValue === minValue ? 1 : (maxValue - minValue);
  const chartWidth = width - (padding * 2);
  const chartHeight = height - (padding * 2);

  return values
    .map((value, index) => {
      const x = padding + ((values.length === 1 ? 0.5 : index / (values.length - 1)) * chartWidth);
      const y = height - padding - (((value - minValue) / valueSpan) * chartHeight);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function renderInlineSelectedStat({ selectedStat, preferences }) {
  if (!selectedStat || !selectedStat.root || !selectedStat.quality) {
    return '';
  }

  const { root, quality } = selectedStat;
  const title = formatDisplayChordSymbol(root, quality);
  const attempts = attemptsFor(preferences.attemptTimes, root, quality);
  const average = averageAttemptTime(preferences.attemptTimes, root, quality);
  const maxValue = attempts.length ? Math.max(...attempts) : null;
  const minValue = attempts.length ? Math.min(...attempts) : null;
  const width = 900;
  const height = 320;
  const padding = 40;
  const pathPoints = buildTimeSeriesPath(attempts, width, height, padding);

  const graphMarkup = attempts.length
    ? `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Time versus attempt graph for ${escapeHtml(title)}">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#9ca3af" stroke-width="1" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#9ca3af" stroke-width="1" />
        <polyline points="${pathPoints}" fill="none" stroke="#2563eb" stroke-width="2" />
        <text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="12" fill="#374151">Attempt Number</text>
        <text x="16" y="${height / 2}" text-anchor="middle" font-size="12" fill="#374151" transform="rotate(-90 16 ${height / 2})">Time (seconds)</text>
      </svg>`
    : '<p class="subtitle">No attempts recorded yet for this key/chord quality.</p>';

  const summary = attempts.length
    ? `Average Time: ${average.toFixed(2)}s | Attempts: ${attempts.length} | Min: ${minValue.toFixed(2)}s | Max: ${maxValue.toFixed(2)}s`
    : 'Average Time: — | Attempts: 0';

  return `<section class="selected-stat-panel">
      <h3>${escapeHtml(title)} Time vs Attempt</h3>
      <p class="subtitle">${summary}</p>
      <div class="table-wrap">${graphMarkup}</div>
    </section>`;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function ratioCellColor(ratio) {
  if (ratio === null) {
    return { background: 'rgb(243, 244, 246)', foreground: '#374151' };
  }

  return {
    background: `rgb(${lerp(254, 220, ratio)}, ${lerp(226, 252, ratio)}, ${lerp(226, 231, ratio)})`,
    foreground: ratio >= 0.5 ? '#14532d' : '#7f1d1d'
  };
}

function correctIncorrectRatio(scores, attemptTimes, root, quality) {
  const attempts = attemptsFor(attemptTimes, root, quality).length;
  if (attempts === 0) {
    return { attempts: 0, correct: 0, incorrect: 0, ratio: null, label: '—' };
  }

  const score = scoreValue(scores, root, quality);
  const estimatedCorrect = Math.round((attempts + score) / 2);
  const correct = Math.min(attempts, Math.max(0, estimatedCorrect));
  const incorrect = Math.max(0, attempts - correct);
  const ratio = correct / attempts;

  return {
    attempts,
    correct,
    incorrect,
    ratio,
    label: `${correct}/${incorrect}`
  };
}

function selectedAxes(options, preferences) {
  const selectedKeys = (preferences.includeKeys || []).filter((item) => options.keys.includes(item));
  const selectedQualities = (preferences.includeChordQualities || []).filter((item) => options.chord_qualities.includes(item));

  return {
    keys: selectedKeys.length ? selectedKeys : [...options.keys],
    chordQualities: selectedQualities.length ? selectedQualities : [...options.chord_qualities]
  };
}

function renderStatsPanel({ options, preferences, selectedStat }) {
  const axes = selectedAxes(options, preferences);
  const availableCombos = chartAvailableComboSet(preferences);
  const headerCells = axes.chordQualities.map((quality) => `<th>${quality}</th>`).join('');
  const bodyRows = axes.keys
    .map((root) => {
      const cells = axes.chordQualities
        .map((quality) => {
          const comboKey = `${root}|${quality}`;
          const isUnavailable = availableCombos && !availableCombos.has(comboKey);
          if (isUnavailable) {
            return `<td class="score-cell unavailable-score-cell" title="Not present in loaded chart">
            <span class="score-link score-link-disabled">—</span>
          </td>`;
          }

          const ratioData = correctIncorrectRatio(preferences.scores, preferences.attemptTimes, root, quality);
          const colors = ratioCellColor(ratioData.ratio);
          const graphUrl = `/select-stat?root=${encodeURIComponent(root)}&quality=${encodeURIComponent(quality)}`;
          const isSelected = selectedStat && selectedStat.root === root && selectedStat.quality === quality;
          const cellClass = isSelected ? 'score-cell selected-score-cell' : 'score-cell';
          const ratioTitle = ratioData.attempts
            ? `${ratioData.correct} correct / ${ratioData.incorrect} incorrect (${Math.round(ratioData.ratio * 100)}%)`
            : 'No attempts yet';
          return `<td class="${cellClass}" style="background:${colors.background};color:${colors.foreground}">
            <a class="score-link" href="${graphUrl}" title="${escapeHtml(ratioTitle)}">${ratioData.label}</a>
          </td>`;
        })
        .join('');
      return `<tr><th>${escapeHtml(formatDisplayNote(root))}</th>${cells}</tr>`;
    })
    .join('');

  return `
      <aside class="stats-panel">
        <h2>Stats</h2>
        <p class="subtitle">Selected keys × chord qualities</p>

        <div class="table-wrap">
          <table class="stats-table">
            <thead>
              <tr><th>Key</th>${headerCells}</tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
          </table>
        </div>

        <p class="footer-note">Cells show correct/incorrect ratio. Click a cell to view timing graph below the stats table.</p>
      </aside>`;
}

function rootPitchClass(prompt) {
  if (prompt && Array.isArray(prompt.notes) && prompt.notes.length > 0) {
    const rank = noteOrderRank(prompt.notes[0]);
    if (Number.isFinite(rank) && rank !== Number.MAX_SAFE_INTEGER) {
      return rank;
    }
  }

  const symbol = String(prompt && prompt.symbol ? prompt.symbol : '').trim();
  const match = symbol.match(/^([A-Ga-g])([#b]?)/);
  if (!match) {
    return null;
  }

  const tonic = match[1].toUpperCase();
  const accidental = match[2] === 'b' ? 'B' : match[2];
  const rank = noteOrderRank(`${tonic}${accidental}`);
  if (Number.isFinite(rank) && rank !== Number.MAX_SAFE_INTEGER) {
    return rank;
  }

  return null;
}

function renderMainPage({ prompt, score, round, resultMessage, resultClass, options, preferences, selectedStat, activeUser = '', savedUsers = [], overallElapsedSeconds = 0 }) {
  const safePrompt = prompt.symbol;
  const circleMarkup = renderCircleOfFifths(options, preferences.includeKeys);
  const activeChart = coerceChartQuiz(preferences.chartQuiz);
  const activeChartTitle = activeChart ? activeChart.title : '';
  const instrumentKey = coerceInstrumentKey(preferences.instrumentKey);
  const savedUserOptions = (Array.isArray(savedUsers) ? savedUsers : [])
    .map((user) => normalizeUserName(user))
    .filter(Boolean)
    .map((user) => `<option value="${escapeHtml(user)}" ${user === activeUser ? 'selected' : ''}>${escapeHtml(user)}</option>`)
    .join('');
  const safeOverallElapsedSeconds = Number.isFinite(Number(overallElapsedSeconds))
    ? Math.max(0, Number(overallElapsedSeconds))
    : 0;
  const resultHtml = resultMessage
    ? `<div id="quizResult" class="result ${resultClass}">${resultMessage}</div>`
    : '';
  const statsPanel = renderStatsPanel({ options, preferences, selectedStat });
  const inlineGraph = renderInlineSelectedStat({ selectedStat, preferences });
  const namedSavePanel = `<form id="namedSaveForm" method="post" action="/user/save" class="named-save-panel" autocomplete="off">
            <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input type="password" name="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <div class="named-save-ribbon">
              <strong class="named-save-title">Profile</strong>
              <div class="named-save-fields">
                <label class="sr-only" for="activeUser">User Name</label>
                <input id="activeUser" name="activeUser" type="text" value="${escapeHtml(activeUser)}" placeholder="User name" maxlength="40" />
                <label class="sr-only" for="savedUsers">Saved Users</label>
                <select id="savedUsers" name="savedUsers">
                  <option value="">Saved users...</option>
                  ${savedUserOptions}
                </select>
              </div>
              <div class="actions named-save-actions">
                <button type="submit" formaction="/user/load" formmethod="post">Load</button>
                <button type="submit" formaction="/user/save" formmethod="post">Save</button>
                <button type="submit" formaction="/quit" formmethod="post">Quit</button>
              </div>
            </div>
          </form>`;
  const filtersPanel = `<form method="post" action="/preferences" class="prefs" autocomplete="off">
            <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input type="password" name="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <h2>Practice Filters</h2>
            <div class="prefs-tabs" role="tablist" aria-label="Practice Mode Tabs">
              <button type="button" id="tabButtonJazz" class="prefs-tab-button active" role="tab" aria-selected="true" aria-controls="tabPanelJazz" data-tab-target="tabPanelJazz">Jazz 1460</button>
              <button type="button" id="tabButtonManual" class="prefs-tab-button" role="tab" aria-selected="false" aria-controls="tabPanelManual" data-tab-target="tabPanelManual">Circle + Qualities</button>
            </div>
            <div class="prefs-tab-panels">
              <section id="tabPanelJazz" class="prefs-tab-panel active" role="tabpanel" aria-labelledby="tabButtonJazz">
                <h3>Jazz 1460 Song Mode</h3>
                <label for="instrumentKey">Instrument Key</label>
                <select id="instrumentKey" name="instrumentKey">
                  <option value="C" ${instrumentKey === 'C' ? 'selected' : ''}>C (Concert Key)</option>
                  <option value="Bb" ${instrumentKey === 'Bb' ? 'selected' : ''}>Bb</option>
                  <option value="Eb" ${instrumentKey === 'Eb' ? 'selected' : ''}>Eb</option>
                </select>
                <label class="sr-only" for="irealSongSelect">Jazz 1460 song</label>
                <select id="irealSongSelect" name="songTitle" data-active-title="${escapeHtml(activeChartTitle)}">
                  <option value="">Load songs...</option>
                </select>
                <div class="actions">
                  <button type="submit" formaction="/ireal-song-select" formmethod="post">Load Song Chart</button>
                  <button type="submit" formaction="/ireal-song-clear" formmethod="post">Clear Song Mode</button>
                </div>
                <p class="footer-note">${activeChart ? `Active chart: ${escapeHtml(activeChart.title)} (${activeChart.chords.length} supported chords) | Instrument: ${escapeHtml(instrumentKey)}` : 'No active chart. Load a song to quiz only its chords.'}</p>
              </section>
              <section id="tabPanelManual" class="prefs-tab-panel" role="tabpanel" aria-labelledby="tabButtonManual" hidden>
                <h3>Include Chord Qualities</h3>
                <div class="checks quality-checks">${checkboxGrid('includeChordQualities', options.chord_qualities, preferences.includeChordQualities)}</div>
                <h3>Include Keys</h3>
                ${circleMarkup}
                <div class="actions">
                  <button type="submit">Save Filters</button>
                  <button type="submit" formaction="/clear-scores" formmethod="post">Clear Score</button>
                </div>
              </section>
            </div>
          </form>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Woodshed Web</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body>
    <main class="container">
      <h1>Woodshed</h1>
      <p class="subtitle">Seventh Chord Note Trainer</p>
      ${namedSavePanel}

      <div class="app-layout">
        <section class="quiz-panel">
          <div class="meta">Round: ${round} | Score: ${score} | Overall: <strong id="overallTimer" data-base-seconds="${safeOverallElapsedSeconds.toFixed(3)}">00:00</strong></div>
          <div id="quizPrompt" class="prompt">${safePrompt}</div>

          <form method="post" action="/check" autocomplete="off">
            <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input type="password" name="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input id="overallElapsedSecondsInput" name="overallElapsedSeconds" type="hidden" value="${safeOverallElapsedSeconds.toFixed(3)}" />

            <div id="quizPlayArea">
              <label for="answer">Enter 4 notes in any order</label>
              <input id="answer" name="answer" type="text" placeholder="C E G B or C,E,G,B" autocomplete="off" autofocus required />

              <div class="actions">
                <button type="submit">Submit</button>
                <a class="link-btn" href="/">Restart</a>
              </div>
            </div>
          </form>

          ${resultHtml}
          <p class="footer-note">Use spaces or commas between notes.</p>
        </section>

        <section class="side-panel">
          ${filtersPanel}
          ${statsPanel}
          ${inlineGraph}
        </section>
      </div>
    </main>
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const forms = document.querySelectorAll('form');
        forms.forEach((form) => form.setAttribute('autocomplete', 'off'));
        const namedSaveForm = document.getElementById('namedSaveForm');
        const activeUserInput = document.getElementById('activeUser');
        const savedUsersSelect = document.getElementById('savedUsers');

        if (savedUsersSelect && namedSaveForm) {
          savedUsersSelect.addEventListener('change', () => {
            const selectedUser = String(savedUsersSelect.value || '').trim();
            if (!selectedUser) {
              return;
            }

            if (activeUserInput) {
              activeUserInput.value = selectedUser;
            }

            namedSaveForm.action = '/user/load';
            namedSaveForm.method = 'post';
            namedSaveForm.submit();
          });
        }

        const tabButtons = Array.from(document.querySelectorAll('.prefs-tab-button'));
        const tabPanels = Array.from(document.querySelectorAll('.prefs-tab-panel'));
        const activateTab = (targetId) => {
          tabButtons.forEach((button) => {
            const isActive = button.getAttribute('data-tab-target') === targetId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
          tabPanels.forEach((panel) => {
            const isActive = panel.id === targetId;
            panel.classList.toggle('active', isActive);
            panel.hidden = !isActive;
          });
        };
        tabButtons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-tab-target');
            if (!targetId) {
              return;
            }
            activateTab(targetId);
          });
        });
        activateTab('tabPanelJazz');

        const irealSongSelect = document.getElementById('irealSongSelect');
        if (irealSongSelect) {
          fetch('/ireal-songs')
            .then((response) => {
              if (!response.ok) {
                throw new Error('Failed to load song catalog');
              }
              return response.json();
            })
            .then((payload) => {
              const songs = Array.isArray(payload && payload.songs) ? payload.songs : [];
              const activeTitle = String(irealSongSelect.getAttribute('data-active-title') || '').trim();
              irealSongSelect.innerHTML = '<option value="">Select a song...</option>';
              songs.forEach((title) => {
                const option = document.createElement('option');
                option.value = title;
                option.textContent = title;
                if (activeTitle && title === activeTitle) {
                  option.selected = true;
                }
                irealSongSelect.appendChild(option);
              });
            })
            .catch(() => {
              irealSongSelect.innerHTML = '<option value="">Catalog unavailable</option>';
            });
        }

        const fifthButtons = Array.from(document.querySelectorAll('.fifths-key'));
        const keyInputs = new Map(
          Array.from(document.querySelectorAll('.key-selection-input'))
            .map((input) => [input.id, input])
        );

        const syncFifthsButton = (button) => {
          const inputId = button.getAttribute('data-input-id');
          const linkedInput = keyInputs.get(inputId);
          const isSelected = Boolean(linkedInput && linkedInput.checked);
          button.classList.toggle('selected', isSelected);
          button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        };

        fifthButtons.forEach((button) => {
          syncFifthsButton(button);
          button.addEventListener('click', () => {
            const inputId = button.getAttribute('data-input-id');
            const linkedInput = keyInputs.get(inputId);
            if (!linkedInput) {
              return;
            }

            linkedInput.checked = !linkedInput.checked;
            syncFifthsButton(button);
          });
        });

        const answerInput = document.getElementById('answer');
        if (answerInput) {
          answerInput.setAttribute('autocomplete', 'off');
          answerInput.setAttribute('autocorrect', 'off');
          answerInput.setAttribute('autocapitalize', 'off');
          answerInput.setAttribute('spellcheck', 'false');

          const overallElapsedSecondsInput = document.getElementById('overallElapsedSecondsInput');
          const overallTimer = document.getElementById('overallTimer');
          const quizForm = answerInput.closest('form');
          const timerStartedAt = Date.now();
          const baseOverallSeconds = overallTimer
            ? Math.max(0, Number(overallTimer.getAttribute('data-base-seconds')) || 0)
            : 0;
          const effectiveElapsedSeconds = (nowMs) => Math.max(0, (nowMs - timerStartedAt) / 1000);

          const formatMMSS = (totalSeconds) => {
            const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
            const hours = Math.floor(wholeSeconds / 3600);
            const minutes = Math.floor(wholeSeconds / 60);
            const seconds = wholeSeconds % 60;
            if (hours > 0) {
              const remainingMinutes = Math.floor((wholeSeconds % 3600) / 60);
              return String(hours).padStart(2, '0') + ':' + String(remainingMinutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
            }
            return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
          };

          const updateTimerDisplay = () => {
            const now = Date.now();
            const elapsedSeconds = effectiveElapsedSeconds(now);
            const overallSeconds = baseOverallSeconds + elapsedSeconds;
            if (overallTimer) {
              overallTimer.textContent = formatMMSS(overallSeconds);
            }
            if (overallElapsedSecondsInput) {
              overallElapsedSecondsInput.value = overallSeconds.toFixed(3);
            }
          };

          if (quizForm) {
            quizForm.addEventListener('submit', () => {
              const now = Date.now();
              if (overallElapsedSecondsInput) {
                overallElapsedSecondsInput.value = (baseOverallSeconds + effectiveElapsedSeconds(now)).toFixed(3);
              }
            });
          }

          updateTimerDisplay();
          window.setInterval(updateTimerDisplay, 100);

        }
      });
    </script>
  </body>
</html>`;
}

app.get('/', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const preferences = ensureSessionPreferences(req, options);
    const score = Number.isInteger(req.session.score) ? req.session.score : 0;
    const round = Number.isInteger(req.session.round) ? req.session.round : 1;
    const selectedStat = req.session.selectedStat || null;
    const overallElapsedSeconds = Number(req.session.overallElapsedSeconds);

    if (!isValidPrompt(req.session.prompt)) {
      const prompt = await callApi('/prompt', buildPromptPayload(preferences));
      req.session.prompt = prompt;
      req.session.promptStartedAtMs = Date.now();
    }

    res.send(
      renderMainPage({
        prompt: req.session.prompt,
        score,
        round,
        options,
        preferences,
        selectedStat,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: Number.isFinite(overallElapsedSeconds) && overallElapsedSeconds >= 0 ? overallElapsedSeconds : 0,
        resultMessage: '',
        resultClass: ''
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to initialize quiz: ${error.message}`);
  }
});

app.get('/ireal-songs', async (req, res) => {
  try {
    const payload = await callApi('/ireal/jazz1460/songs');
    res.json({ songs: Array.isArray(payload.songs) ? payload.songs : [] });
  } catch {
    res.json({ songs: [] });
  }
});

app.post('/ireal-song-select', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    req.session.activeUser = normalizeUserName(req.body.activeUser || req.session.activeUser);
    const selectedTitle = String(req.body.songTitle || '').trim();
    if (!selectedTitle) {
      throw new Error('Choose a song before loading chart mode.');
    }

    const chart = await callApi('/ireal/jazz1460/song', { title: selectedTitle });
    if (!Array.isArray(chart.quiz_chords) || chart.quiz_chords.length === 0) {
      throw new Error('No supported chart chords were found for this song.');
    }

    const currentPreferences = req.session.preferences || defaultPreferences(options);
    const instrumentKey = coerceInstrumentKey(req.body.instrumentKey || currentPreferences.instrumentKey);
    const preferences = resetScores({
      ...currentPreferences,
      instrumentKey,
      chartQuiz: {
        title: String(chart.title || selectedTitle),
        chords: chart.quiz_chords
      }
    });

    req.session.preferences = preferences;
    req.session.selectedStat = null;
    req.session.score = 0;
    req.session.round = 1;
    req.session.overallElapsedSeconds = 0;
    req.session.prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.promptStartedAtMs = Date.now();
    await persistActiveUserState(req);

    res.send(
      renderMainPage({
        prompt: req.session.prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: 0,
        resultMessage: `Loaded chart mode for ${escapeHtml(preferences.chartQuiz.title)} (${preferences.chartQuiz.chords.length} supported chords).`,
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to load chart mode: ${error.message}`);
  }
});

app.post('/ireal-song-clear', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    req.session.activeUser = normalizeUserName(req.body.activeUser || req.session.activeUser);

    const currentPreferences = req.session.preferences || defaultPreferences(options);
    const instrumentKey = coerceInstrumentKey(req.body.instrumentKey || currentPreferences.instrumentKey);
    const preferences = resetScores({
      ...currentPreferences,
      instrumentKey,
      chartQuiz: null
    });

    req.session.preferences = preferences;
    req.session.selectedStat = null;
    req.session.score = 0;
    req.session.round = 1;
    req.session.overallElapsedSeconds = 0;
    req.session.prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.promptStartedAtMs = Date.now();
    await persistActiveUserState(req);

    res.send(
      renderMainPage({
        prompt: req.session.prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: 0,
        resultMessage: 'Song chart mode cleared. Returning to key/chord filter mode.',
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to clear chart mode: ${error.message}`);
  }
});

app.post('/user/load', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const requestedUser = normalizeUserName(req.body.activeUser || req.session.activeUser);

    if (!requestedUser) {
      const preferences = ensureSessionPreferences(req, options);
      if (!isValidPrompt(req.session.prompt)) {
        req.session.prompt = await callApi('/prompt', buildPromptPayload(preferences));
        req.session.promptStartedAtMs = Date.now();
      }

      res.send(
        renderMainPage({
          prompt: req.session.prompt,
          score: Number.isInteger(req.session.score) ? req.session.score : 0,
          round: Number.isInteger(req.session.round) ? req.session.round : 1,
          options,
          preferences,
          selectedStat: req.session.selectedStat || null,
          activeUser: '',
          savedUsers,
          overallElapsedSeconds: Number.isFinite(Number(req.session.overallElapsedSeconds)) ? Number(req.session.overallElapsedSeconds) : 0,
          resultMessage: 'Enter a user name to load or create a save.',
          resultClass: 'bad'
        })
      );
      return;
    }

    req.session.activeUser = requestedUser;
    const saves = await readUserSaves();
    const savedState = plainObject(saves[requestedUser]).state;

    if (savedState) {
      applySavedStateToSession(req, options, savedState);
    } else {
      req.session.preferences = defaultPreferences(options);
      req.session.preferences.scores = {};
      req.session.preferences.attemptTimes = {};
      req.session.score = 0;
      req.session.round = 1;
      req.session.selectedStat = null;
      req.session.overallElapsedSeconds = 0;
      req.session.prompt = null;
      req.session.promptStartedAtMs = Date.now();
    }

    const preferences = ensureSessionPreferences(req, options);
    if (!isValidPrompt(req.session.prompt)) {
      req.session.prompt = await callApi('/prompt', buildPromptPayload(preferences));
      req.session.promptStartedAtMs = Date.now();
    }

    await persistActiveUserState(req);
    const refreshedSavedUsers = await listSavedUserNames();

    res.send(
      renderMainPage({
        prompt: req.session.prompt,
        score: Number.isInteger(req.session.score) ? req.session.score : 0,
        round: Number.isInteger(req.session.round) ? req.session.round : 1,
        options,
        preferences,
        selectedStat: req.session.selectedStat || null,
        activeUser: requestedUser,
        savedUsers: refreshedSavedUsers,
        overallElapsedSeconds: Number.isFinite(Number(req.session.overallElapsedSeconds)) ? Number(req.session.overallElapsedSeconds) : 0,
        resultMessage: savedState ? `Loaded save for ${escapeHtml(requestedUser)}.` : `Created new save for ${escapeHtml(requestedUser)}.`,
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to load user save: ${error.message}`);
  }
});

app.post('/user/save', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const activeUser = normalizeUserName(req.body.activeUser || req.session.activeUser);
    if (!activeUser) {
      throw new Error('Enter a user name before saving.');
    }

    req.session.activeUser = activeUser;
    const preferences = ensureSessionPreferences(req, options);
    if (!isValidPrompt(req.session.prompt)) {
      req.session.prompt = await callApi('/prompt', buildPromptPayload(preferences));
      req.session.promptStartedAtMs = Date.now();
    }

    await persistActiveUserState(req);
    const refreshedSavedUsers = await listSavedUserNames();

    res.send(
      renderMainPage({
        prompt: req.session.prompt,
        score: Number.isInteger(req.session.score) ? req.session.score : 0,
        round: Number.isInteger(req.session.round) ? req.session.round : 1,
        options,
        preferences,
        selectedStat: req.session.selectedStat || null,
        activeUser,
        savedUsers: refreshedSavedUsers,
        overallElapsedSeconds: Number.isFinite(Number(req.session.overallElapsedSeconds)) ? Number(req.session.overallElapsedSeconds) : 0,
        resultMessage: `Saved progress for ${escapeHtml(activeUser)}.`,
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to save user profile: ${error.message}`);
  }
});

app.post('/preferences', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    req.session.activeUser = normalizeUserName(req.body.activeUser || req.session.activeUser);
    const merged = mergePreferences(req.body, req.session.preferences, options);
    const preferences = resetScores(merged);

    if (preferences.includeKeys.length === 0) {
      throw new Error('Select at least one key in Include Keys');
    }
    if (preferences.includeChordQualities.length === 0) {
      throw new Error('Select at least one chord quality in Include Chord Qualities');
    }

    req.session.preferences = preferences;
    const prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.prompt = prompt;
    req.session.promptStartedAtMs = Date.now();
    req.session.score = 0;
    req.session.round = 1;
    req.session.selectedStat = null;
    req.session.overallElapsedSeconds = 0;
    await persistActiveUserState(req);

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: 0,
        resultMessage: 'Filters saved. Score cleared for new filter set.',
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to save filters: ${error.message}`);
  }
});

app.get('/stats', async (req, res) => {
  res.redirect('/');
});

app.get('/select-stat', async (req, res) => {
  try {
    const currentPrompt = req.session.prompt;
    if (!currentPrompt || !Array.isArray(currentPrompt.notes) || !currentPrompt.symbol) {
      res.redirect('/');
      return;
    }

    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};
    req.session.preferences = preferences;

    const axes = selectedAxes(options, preferences);
    const availableCombos = chartAvailableComboSet(preferences);
    const root = String(req.query.root || '');
    const quality = String(req.query.quality || '');

    if (!axes.keys.includes(root) || !axes.chordQualities.includes(quality)) {
      res.status(400).send('Invalid key or chord quality selection.');
      return;
    }

    if (availableCombos && !availableCombos.has(`${root}|${quality}`)) {
      res.status(400).send('Selected key/chord quality is not present in the loaded chart.');
      return;
    }

    const selectedStat = { root, quality };
    req.session.selectedStat = selectedStat;
    await persistActiveUserState(req);

    const score = Number.isInteger(req.session.score) ? req.session.score : 0;
    const round = Number.isInteger(req.session.round) ? req.session.round : 1;
    const overallElapsedSeconds = Number(req.session.overallElapsedSeconds);

    res.send(
      renderMainPage({
        prompt: currentPrompt,
        score,
        round,
        options,
        preferences,
        selectedStat,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: Number.isFinite(overallElapsedSeconds) && overallElapsedSeconds >= 0 ? overallElapsedSeconds : 0,
        resultMessage: '',
        resultClass: ''
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to select stat: ${error.message}`);
  }
});

app.get('/stats-data', async (req, res) => {
  try {
    const options = await callApi('/options');
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};
    req.session.preferences = preferences;

    const axes = selectedAxes(options, preferences);

    res.json({
      keys: axes.keys,
      chord_qualities: axes.chordQualities,
      scores: preferences.scores,
      attempt_times: preferences.attemptTimes,
      average_attempt_times: averageAttemptTimeMatrix(axes.keys, axes.chordQualities, preferences.attemptTimes)
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to load stats data: ${error.message}` });
  }
});

app.post('/clear-scores', async (req, res) => {
  try {
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const currentPreferences = req.session.preferences || defaultPreferences(options);
    const preferences = resetScores(currentPreferences);
    req.session.preferences = preferences;
    req.session.selectedStat = null;

    const prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.prompt = prompt;
    req.session.promptStartedAtMs = Date.now();
    req.session.score = 0;
    req.session.round = 1;
    req.session.overallElapsedSeconds = 0;
    await persistActiveUserState(req);

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds: 0,
        resultMessage: 'Score cleared.',
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to clear score: ${error.message}`);
  }
});

app.post('/check', async (req, res) => {
  try {
    const currentPrompt = req.session.prompt;
    if (!currentPrompt || !Array.isArray(currentPrompt.notes) || !currentPrompt.symbol) {
      res.redirect('/');
      return;
    }

    const answer = String(req.body.answer || '');
    const score = Number.isInteger(req.session.score) ? req.session.score : 0;
    const round = Number.isInteger(req.session.round) ? req.session.round : 1;
    const submittedOverallElapsed = Number(req.body.overallElapsedSeconds);
    const overallElapsedSeconds = Number.isFinite(submittedOverallElapsed) && submittedOverallElapsed >= 0
      ? submittedOverallElapsed
      : (Number.isFinite(Number(req.session.overallElapsedSeconds)) ? Number(req.session.overallElapsedSeconds) : 0);
    const options = await callApi('/options');
    const savedUsers = await listSavedUserNames();
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};

    const startedAtMs = Number(req.session.promptStartedAtMs);
    const answerTimeSeconds = Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : null;

    const check = await callApi('/check', {
      symbol: currentPrompt.symbol,
      notes: currentPrompt.notes,
      answer,
      scores: preferences.scores,
      attempt_times: preferences.attemptTimes,
      answer_time_seconds: answerTimeSeconds
    });
    const isCorrect = Boolean(check.is_correct);
    preferences.scores = check.updated_scores || preferences.scores;
    preferences.attemptTimes = check.updated_attempt_times || preferences.attemptTimes;

    const nextPrompt = await callApi('/prompt', buildPromptPayload(preferences));
    const nextScore = isCorrect ? score + 1 : score;
    const nextRound = round + 1;

    req.session.prompt = nextPrompt;
    req.session.promptStartedAtMs = Date.now();
    req.session.score = nextScore;
    req.session.round = nextRound;
    req.session.preferences = preferences;
    req.session.overallElapsedSeconds = overallElapsedSeconds;
    const selectedStat = req.session.selectedStat || null;
    await persistActiveUserState(req);

    const message = isCorrect
      ? `Correct. ${escapeHtml(currentPrompt.symbol)} = ${escapeHtml(formatDisplayNotesList(currentPrompt.notes))}`
      : renderIncorrectAnswerMessage(currentPrompt.symbol, answer, currentPrompt.notes);

    res.send(
      renderMainPage({
        prompt: nextPrompt,
        score: nextScore,
        round: nextRound,
        options,
        preferences,
        selectedStat,
        activeUser: normalizeUserName(req.session.activeUser),
        savedUsers,
        overallElapsedSeconds,
        resultMessage: message,
        resultClass: isCorrect ? 'ok' : 'bad'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to check answer: ${error.message}`);
  }
});

app.post('/quit', async (req, res) => {
  const apiPort = parsePortFromUrl(API_BASE_URL, 8010);
  const webPort = Number.isFinite(Number(PORT)) ? Number(PORT) : 3010;
  const shutdownScriptPath = path.resolve(__dirname, '..', 'scripts', 'restart-woodshed.ps1');

  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Woodshed Shutting Down</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body>
    <main class="container">
      <h1>Woodshed</h1>
      <p class="subtitle">Shutting down Woodshed processes...</p>
      <p class="footer-note">You can close this tab. Relaunch with Launch-Woodshed-Web.bat when ready.</p>
    </main>
  </body>
</html>`);

  setTimeout(() => {
    const psArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      shutdownScriptPath,
      '-ApiPort',
      String(apiPort),
      '-WebPort',
      String(webPort)
    ];

    const child = spawn('powershell', psArgs, {
      cwd: path.resolve(__dirname, '..'),
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  }, 150);
});

ensureUserSavesTable()
  .catch((error) => {
    console.error('Failed to ensure user_saves table exists:', error);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Woodshed web running at http://localhost:${PORT}`);
      console.log(`Using Woodshed API: ${API_BASE_URL}`);
      console.log(pgPool ? 'Persistence: Postgres (DATABASE_URL set)' : 'Persistence: in-memory (no DATABASE_URL)');
    });
  });
