const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.WOODSHED_API_URL || 'http://127.0.0.1:8000';

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
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

  return {
    ...(existingPreferences || {}),
    includeKeys: includeKeys.filter((item) => options.keys.includes(item)),
    includeChordQualities: includeChordQualities.filter((item) => options.chord_qualities.includes(item))
  };
}

function defaultPreferences(options) {
  return {
    includeKeys: [...options.keys],
    includeChordQualities: [...options.chord_qualities]
  };
}

function checkboxGrid(name, items, selectedItems, labelFormatter = (value) => String(value)) {
  const selected = new Set(selectedItems);
  return items
    .map(
      (item) => `<label class="check-item"><input type="checkbox" name="${name}" value="${escapeHtml(item)}" ${selected.has(item) ? 'checked' : ''} /> ${escapeHtml(labelFormatter(item))}</label>`
    )
    .join('');
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
  return String(value || '').trim().toUpperCase();
}

const NOTE_PITCH_ORDER = new Map([
  ['C', 0], ['B#', 0],
  ['C#', 1], ['DB', 1],
  ['D', 2],
  ['D#', 3], ['EB', 3],
  ['E', 4], ['FB', 4],
  ['F', 5], ['E#', 5],
  ['F#', 6], ['GB', 6],
  ['G', 7],
  ['G#', 8], ['AB', 8],
  ['A', 9],
  ['A#', 10], ['BB', 10],
  ['B', 11], ['CB', 11]
]);

function noteOrderRank(note) {
  const normalized = normalizeNote(note);
  if (NOTE_PITCH_ORDER.has(normalized)) {
    return NOTE_PITCH_ORDER.get(normalized);
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
    const normalized = normalizeNote(note);
    if (!normalized) {
      return;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
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
    const normalized = normalizeNote(note);
    const available = normalizedCorrectCounts.get(normalized) || 0;
    if (available > 0) {
      normalizedCorrectCounts.set(normalized, available - 1);
      matchedCounts.set(normalized, (matchedCounts.get(normalized) || 0) + 1);
      return 'note-match';
    }
    return 'note-extra';
  });

  const correctClasses = correctNotes.map((note) => {
    const normalized = normalizeNote(note);
    const matched = matchedCounts.get(normalized) || 0;
    if (matched > 0) {
      matchedCounts.set(normalized, matched - 1);
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
  return {
    include_keys: preferences.includeKeys,
    include_chord_qualities: preferences.includeChordQualities,
    exclude_keys: [],
    exclude_chord_qualities: [],
    scores: preferences.scores
  };
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

function renderAttemptGraphPage({ root, quality, attempts }) {
  const title = formatDisplayChordSymbol(root, quality);
  const average = attempts.length
    ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length
    : null;
  const maxValue = attempts.length ? Math.max(...attempts) : null;
  const minValue = attempts.length ? Math.min(...attempts) : null;
  const width = 900;
  const height = 320;
  const padding = 40;
  const pathPoints = buildTimeSeriesPath(attempts, width, height, padding);

  const graphMarkup = attempts.length
    ? `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Attempt time graph for ${escapeHtml(title)}">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#9ca3af" stroke-width="1" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#9ca3af" stroke-width="1" />
        <polyline points="${pathPoints}" fill="none" stroke="#2563eb" stroke-width="2" />
      </svg>`
    : '<p class="subtitle">No attempts recorded for this key/chord-quality yet.</p>';

  const statsSummary = attempts.length
    ? `<p class="subtitle">Attempts: ${attempts.length} | Avg: ${average.toFixed(2)}s | Min: ${minValue.toFixed(2)}s | Max: ${maxValue.toFixed(2)}s</p>`
    : '<p class="subtitle">Attempts: 0</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Woodshed Time Graph</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body>
    <main class="container">
      <h1>${escapeHtml(title)} Response Time</h1>
      ${statsSummary}

      <div class="actions">
        <a class="link-btn" href="/">Back to Quiz</a>
      </div>

      <div class="table-wrap">
        ${graphMarkup}
      </div>

      <p class="footer-note">X-axis: attempt number. Y-axis: answer time in seconds.</p>
    </main>
  </body>
</html>`;
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

function scoreColor(score) {
  if (score === 0) {
    return { background: 'rgb(243, 244, 246)', foreground: '#374151' };
  }

  const intensity = Math.min(1, Math.abs(score) / 6);
  if (score > 0) {
    return {
      background: `rgb(${lerp(220, 22, intensity)}, ${lerp(252, 101, intensity)}, ${lerp(231, 52, intensity)})`,
      foreground: intensity > 0.55 ? '#ffffff' : '#14532d'
    };
  }

  return {
    background: `rgb(${lerp(254, 153, intensity)}, ${lerp(226, 27, intensity)}, ${lerp(226, 27, intensity)})`,
    foreground: intensity > 0.55 ? '#ffffff' : '#7f1d1d'
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
  const headerCells = axes.chordQualities.map((quality) => `<th>${quality}</th>`).join('');
  const bodyRows = axes.keys
    .map((root) => {
      const cells = axes.chordQualities
        .map((quality) => {
          const value = scoreValue(preferences.scores, root, quality);
          const colors = scoreColor(value);
          const graphUrl = `/select-stat?root=${encodeURIComponent(root)}&quality=${encodeURIComponent(quality)}`;
          const isSelected = selectedStat && selectedStat.root === root && selectedStat.quality === quality;
          const cellClass = isSelected ? 'score-cell selected-score-cell' : 'score-cell';
          return `<td class="${cellClass}" style="background:${colors.background};color:${colors.foreground}">
            <a class="score-link" href="${graphUrl}">${value}</a>
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

        <p class="footer-note">0 = untested, +1 correct, -1 incorrect. Click a score to view timing graph below the quiz.</p>
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

function renderKeyboardInput(rootPitch, highlightedNotes = []) {
  const octaveCount = 2;
  const highlightedPitches = new Set(
    (Array.isArray(highlightedNotes) ? highlightedNotes : [])
      .map((note) => noteOrderRank(note))
      .filter((rank) => Number.isFinite(rank) && rank !== Number.MAX_SAFE_INTEGER)
  );
  const whiteKeys = [
    { note: 'C', pitch: 0 },
    { note: 'D', pitch: 2 },
    { note: 'E', pitch: 4 },
    { note: 'F', pitch: 5 },
    { note: 'G', pitch: 7 },
    { note: 'A', pitch: 9 },
    { note: 'B', pitch: 11 }
  ];
  const blackKeys = [
    { note: 'C#', pitch: 1, leftPercent: 10.5 },
    { note: 'D#', pitch: 3, leftPercent: 24.5 },
    { note: 'F#', pitch: 6, leftPercent: 53.5 },
    { note: 'G#', pitch: 8, leftPercent: 67.5 },
    { note: 'A#', pitch: 10, leftPercent: 81.5 }
  ];

  const octaves = Array.from({ length: octaveCount }, (_, octave) => {
    const whiteMarkup = whiteKeys
      .map((key) => {
        const showRootDot = octave === 0 && Number.isFinite(rootPitch) && key.pitch === rootPitch;
        const keyClass = highlightedPitches.has(key.pitch) ? 'piano-key white correct-note' : 'piano-key white';
        return `<button type="button" class="${keyClass}" data-note="${key.note}" data-pitch="${key.pitch}" aria-label="${key.note}">
            ${showRootDot ? '<span class="root-dot" aria-hidden="true"></span>' : ''}
            <span class="key-label">${key.note}</span>
          </button>`;
      })
      .join('');

    const blackMarkup = blackKeys
      .map((key) => {
        const showRootDot = octave === 0 && Number.isFinite(rootPitch) && key.pitch === rootPitch;
        const keyClass = highlightedPitches.has(key.pitch) ? 'piano-key black correct-note' : 'piano-key black';
        return `<button type="button" class="${keyClass}" data-note="${key.note}" data-pitch="${key.pitch}" aria-label="${key.note}" style="left:${key.leftPercent}%">
            ${showRootDot ? '<span class="root-dot" aria-hidden="true"></span>' : ''}
          </button>`;
      })
      .join('');

    return `<div class="keyboard-octave" aria-label="Octave ${octave + 1}">
        <div class="white-keys">${whiteMarkup}</div>
        <div class="black-keys">${blackMarkup}</div>
      </div>`;
  }).join('');

  return `<section class="input-keyboard-wrap" aria-label="Note keyboard input">
      <div class="input-keyboard">${octaves}</div>
      <div class="keyboard-tools" aria-label="Keyboard editing tools">
        <button type="button" class="key-tool-btn" data-key-tool="backspace">Backspace</button>
        <button type="button" class="key-tool-btn" data-key-tool="clear">Clear</button>
      </div>
    </section>`;
}

function renderMainPage({ prompt, score, round, resultMessage, resultClass, options, preferences, selectedStat, highlightedNotes = [], overallElapsedSeconds = 0 }) {
  const safePrompt = prompt.symbol;
  const keyboardMarkup = renderKeyboardInput(rootPitchClass(prompt), highlightedNotes);
  const safeOverallElapsedSeconds = Number.isFinite(Number(overallElapsedSeconds))
    ? Math.max(0, Number(overallElapsedSeconds))
    : 0;
  const resultHtml = resultMessage
    ? `<div id="quizResult" class="result ${resultClass}">${resultMessage}</div>`
    : '';
  const statsPanel = renderStatsPanel({ options, preferences, selectedStat });
  const inlineGraph = renderInlineSelectedStat({ selectedStat, preferences });

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

      <div class="app-layout">
        <section class="quiz-panel">
          <form method="post" action="/preferences" class="prefs" autocomplete="off">
            <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input type="password" name="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <h2>Practice Filters</h2>
            <div class="prefs-grid">
              <section>
                <h3>Include Keys</h3>
                <div class="checks">${checkboxGrid('includeKeys', options.keys, preferences.includeKeys, formatDisplayNote)}</div>
              </section>
              <section>
                <h3>Include Chord Qualities</h3>
                <div class="checks">${checkboxGrid('includeChordQualities', options.chord_qualities, preferences.includeChordQualities)}</div>
              </section>
            </div>
            <div class="actions">
              <button type="submit">Save Filters</button>
              <button type="submit" formaction="/clear-scores" formmethod="post">Clear Score</button>
            </div>
          </form>

          <div class="meta">Round: ${round} | Score: ${score} | Overall: <strong id="overallTimer" data-base-seconds="${safeOverallElapsedSeconds.toFixed(3)}">00:00</strong></div>
          <div id="quizPrompt" class="prompt">${safePrompt}</div>

          <form method="post" action="/check" autocomplete="off">
            <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input type="password" name="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />
            <input id="pausedSeconds" name="pausedSeconds" type="hidden" value="0" />
            <input id="overallElapsedSecondsInput" name="overallElapsedSeconds" type="hidden" value="${safeOverallElapsedSeconds.toFixed(3)}" />

            <div class="timer-bar" aria-live="polite">
              <span class="timer-label">Timer</span>
              <strong id="answerTimer" class="timer-value">0.0s</strong>
              <span id="timerState" class="timer-state">Running</span>
              <button type="button" class="key-tool-btn" id="pauseTimerBtn">Pause</button>
              <button type="button" class="key-tool-btn" id="resumeTimerBtn" hidden>Resume</button>
            </div>

            <p id="pausedNotice" class="paused-notice" hidden>Quiz paused. Press Resume to continue.</p>

            <div id="quizPlayArea">
              <label for="answer">Enter 4 notes in any order</label>
              <input id="answer" name="answer" type="text" placeholder="C E G B or C,E,G,B" autocomplete="off" autofocus required />

              ${keyboardMarkup}

              <div class="actions">
                <button type="submit">Submit</button>
                <a class="link-btn" href="/">Restart</a>
              </div>
            </div>
          </form>

          ${resultHtml}
          <p class="footer-note">Use spaces or commas between notes.</p>
          ${inlineGraph}
        </section>

        ${statsPanel}
      </div>
    </main>
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const forms = document.querySelectorAll('form');
        forms.forEach((form) => form.setAttribute('autocomplete', 'off'));

        const answerInput = document.getElementById('answer');
        if (answerInput) {
          answerInput.setAttribute('autocomplete', 'off');
          answerInput.setAttribute('autocorrect', 'off');
          answerInput.setAttribute('autocapitalize', 'off');
          answerInput.setAttribute('spellcheck', 'false');

          const pausedSecondsInput = document.getElementById('pausedSeconds');
          const overallElapsedSecondsInput = document.getElementById('overallElapsedSecondsInput');
          const overallTimer = document.getElementById('overallTimer');
          const timerValue = document.getElementById('answerTimer');
          const timerState = document.getElementById('timerState');
          const pauseTimerBtn = document.getElementById('pauseTimerBtn');
          const resumeTimerBtn = document.getElementById('resumeTimerBtn');
          const pausedNotice = document.getElementById('pausedNotice');
          const quizPlayArea = document.getElementById('quizPlayArea');
          const quizPrompt = document.getElementById('quizPrompt');
          const quizResult = document.getElementById('quizResult');
          const quizForm = answerInput.closest('form');
          const keyButtons = Array.from(document.querySelectorAll('.piano-key'));
          const keyboardTools = Array.from(document.querySelectorAll('[data-key-tool]'));

          const timerStartedAt = Date.now();
          const baseOverallSeconds = overallTimer
            ? Math.max(0, Number(overallTimer.getAttribute('data-base-seconds')) || 0)
            : 0;
          let totalPausedMs = 0;
          let pausedAtMs = null;

          const effectiveElapsedSeconds = (nowMs) => {
            const activePausedMs = pausedAtMs ? (nowMs - pausedAtMs) : 0;
            return Math.max(0, ((nowMs - timerStartedAt) - totalPausedMs - activePausedMs) / 1000);
          };

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
            const activePausedMs = pausedAtMs ? (now - pausedAtMs) : 0;
            const elapsedSeconds = effectiveElapsedSeconds(now);
            if (timerValue) {
              timerValue.textContent = elapsedSeconds.toFixed(1) + 's';
            }
            if (pausedSecondsInput) {
              pausedSecondsInput.value = ((totalPausedMs + activePausedMs) / 1000).toFixed(3);
            }
            const overallSeconds = baseOverallSeconds + elapsedSeconds;
            if (overallTimer) {
              overallTimer.textContent = formatMMSS(overallSeconds);
            }
            if (overallElapsedSecondsInput) {
              overallElapsedSecondsInput.value = overallSeconds.toFixed(3);
            }
          };

          const setPausedState = (isPaused) => {
            if (timerState) {
              timerState.textContent = isPaused ? 'Paused' : 'Running';
            }
            if (pauseTimerBtn) {
              pauseTimerBtn.hidden = isPaused;
            }
            if (resumeTimerBtn) {
              resumeTimerBtn.hidden = !isPaused;
            }
            if (pausedNotice) {
              pausedNotice.hidden = !isPaused;
            }
            if (quizPlayArea) {
              quizPlayArea.hidden = isPaused;
            }
            if (quizPrompt) {
              quizPrompt.hidden = isPaused;
            }
            if (quizResult) {
              quizResult.hidden = isPaused;
            }

            answerInput.disabled = isPaused;
            keyButtons.forEach((button) => {
              button.disabled = isPaused;
            });
            keyboardTools.forEach((button) => {
              button.disabled = isPaused;
            });

            if (isPaused) {
              answerInput.blur();
            } else {
              answerInput.focus();
            }
          };

          if (pauseTimerBtn) {
            pauseTimerBtn.addEventListener('click', () => {
              if (!pausedAtMs) {
                pausedAtMs = Date.now();
                setPausedState(true);
                updateTimerDisplay();
              }
            });
          }

          if (resumeTimerBtn) {
            resumeTimerBtn.addEventListener('click', () => {
              if (pausedAtMs) {
                totalPausedMs += Date.now() - pausedAtMs;
                pausedAtMs = null;
                setPausedState(false);
                updateTimerDisplay();
              }
            });
          }

          if (quizForm) {
            quizForm.addEventListener('submit', () => {
              const now = Date.now();
              if (pausedAtMs) {
                totalPausedMs += now - pausedAtMs;
                pausedAtMs = null;
              }
              if (pausedSecondsInput) {
                pausedSecondsInput.value = (totalPausedMs / 1000).toFixed(3);
              }
              if (overallElapsedSecondsInput) {
                overallElapsedSecondsInput.value = (baseOverallSeconds + effectiveElapsedSeconds(now)).toFixed(3);
              }
            });
          }

          setPausedState(false);
          updateTimerDisplay();
          window.setInterval(updateTimerDisplay, 100);

          const splitTokens = (value) => value
            .split(/[\s,]+/)
            .map((item) => item.trim())
            .filter(Boolean);

          keyButtons.forEach((button) => {
            button.addEventListener('click', () => {
              const note = button.getAttribute('data-note');
              if (!note) {
                return;
              }

              const current = answerInput.value.trim();
              answerInput.value = current ? (current + ' ' + note) : note;
              answerInput.focus();
            });
          });

          keyboardTools.forEach((button) => {
            button.addEventListener('click', () => {
              const action = button.getAttribute('data-key-tool');
              const tokens = splitTokens(answerInput.value);

              if (action === 'clear') {
                answerInput.value = '';
              } else if (action === 'backspace') {
                tokens.pop();
                answerInput.value = tokens.join(' ');
              }

              answerInput.focus();
            });
          });
        }
      });
    </script>
  </body>
</html>`;
}

app.get('/', async (req, res) => {
  try {
    const options = await callApi('/options');
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};
    req.session.preferences = preferences;

    const prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.prompt = prompt;
    req.session.promptStartedAtMs = Date.now();
    req.session.score = 0;
    req.session.round = 1;
    req.session.selectedStat = null;
    req.session.overallElapsedSeconds = 0;

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
        overallElapsedSeconds: 0,
        resultMessage: '',
        resultClass: ''
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to initialize quiz: ${error.message}`);
  }
});

app.post('/preferences', async (req, res) => {
  try {
    const options = await callApi('/options');
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

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
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
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};
    req.session.preferences = preferences;

    const axes = selectedAxes(options, preferences);
    const root = String(req.query.root || '');
    const quality = String(req.query.quality || '');

    if (!axes.keys.includes(root) || !axes.chordQualities.includes(quality)) {
      res.status(400).send('Invalid key or chord quality selection.');
      return;
    }

    const selectedStat = { root, quality };
    req.session.selectedStat = selectedStat;

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

app.get('/stats/time-series', async (req, res) => {
  try {
    const options = await callApi('/options');
    const root = String(req.query.root || '');
    const quality = String(req.query.quality || '');

    if (!options.keys.includes(root) || !options.chord_qualities.includes(quality)) {
      res.status(400).send('Invalid key or chord quality selection.');
      return;
    }

    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};
    req.session.preferences = preferences;

    const axes = selectedAxes(options, preferences);
    if (!axes.keys.includes(root) || !axes.chordQualities.includes(quality)) {
      res.status(400).send('Key or chord quality is not currently selected in filters.');
      return;
    }

    const attempts = attemptsFor(preferences.attemptTimes, root, quality);
    res.send(renderAttemptGraphPage({ root, quality, attempts }));
  } catch (error) {
    res.status(500).send(`Failed to load time-series graph: ${error.message}`);
  }
});

app.post('/clear-scores', async (req, res) => {
  try {
    const options = await callApi('/options');
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

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
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
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    preferences.attemptTimes = preferences.attemptTimes || {};

    const startedAtMs = Number(req.session.promptStartedAtMs);
    const pausedSeconds = Number(req.body.pausedSeconds);
    const pauseOffsetSeconds = Number.isFinite(pausedSeconds) && pausedSeconds >= 0 ? pausedSeconds : 0;
    const answerTimeSeconds = Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0, ((Date.now() - startedAtMs) / 1000) - pauseOffsetSeconds)
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
        overallElapsedSeconds,
        resultMessage: message,
        resultClass: isCorrect ? 'ok' : 'bad',
        highlightedNotes: isCorrect ? [] : currentPrompt.notes
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to check answer: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Woodshed web running at http://localhost:${PORT}`);
  console.log(`Using Woodshed API: ${API_BASE_URL}`);
});
