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

function checkboxGrid(name, items, selectedItems) {
  const selected = new Set(selectedItems);
  return items
    .map(
      (item) => `<label class="check-item"><input type="checkbox" name="${name}" value="${item}" ${selected.has(item) ? 'checked' : ''} /> ${item}</label>`
    )
    .join('');
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
  const title = `${root}${quality}`;
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
    ? `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Attempt time graph for ${title}">
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
      <h1>${title} Response Time</h1>
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
  const attempts = attemptsFor(preferences.attemptTimes, root, quality);
  const average = averageAttemptTime(preferences.attemptTimes, root, quality);
  const maxValue = attempts.length ? Math.max(...attempts) : null;
  const minValue = attempts.length ? Math.min(...attempts) : null;
  const width = 900;
  const height = 320;
  const padding = 40;
  const pathPoints = buildTimeSeriesPath(attempts, width, height, padding);

  const graphMarkup = attempts.length
    ? `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Time versus attempt graph for ${root}${quality}">
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
      <h3>${root}${quality} Time vs Attempt</h3>
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
      return `<tr><th>${root}</th>${cells}</tr>`;
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

function renderMainPage({ prompt, score, round, resultMessage, resultClass, options, preferences, selectedStat }) {
  const safePrompt = prompt.symbol;
  const resultHtml = resultMessage
    ? `<div class="result ${resultClass}">${resultMessage}</div>`
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
          <form method="post" action="/preferences" class="prefs">
            <h2>Practice Filters</h2>
            <div class="prefs-grid">
              <section>
                <h3>Include Keys</h3>
                <div class="checks">${checkboxGrid('includeKeys', options.keys, preferences.includeKeys)}</div>
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

          <div class="meta">Round: ${round} | Score: ${score}</div>
          <div class="prompt">${safePrompt}</div>

          <form method="post" action="/check">
            <label for="answer">Enter 4 notes in any order</label>
            <input id="answer" name="answer" type="text" placeholder="C E G B or C,E,G,B" autofocus required />

            <div class="actions">
              <button type="submit">Submit</button>
              <a class="link-btn" href="/">Restart</a>
            </div>
          </form>

          ${resultHtml}
          <p class="footer-note">Use spaces or commas between notes.</p>
          ${inlineGraph}
        </section>

        ${statsPanel}
      </div>
    </main>
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

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
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

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
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

    res.send(
      renderMainPage({
        prompt: currentPrompt,
        score,
        round,
        options,
        preferences,
        selectedStat,
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

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        selectedStat: null,
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
    const options = await callApi('/options');
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
    const selectedStat = { root: check.root, quality: check.chord_quality };
    req.session.selectedStat = selectedStat;

    const message = isCorrect
      ? `Correct. ${currentPrompt.symbol} = ${currentPrompt.notes.join(', ')}`
      : `Not quite. ${currentPrompt.symbol} = ${currentPrompt.notes.join(', ')}`;

    res.send(
      renderMainPage({
        prompt: nextPrompt,
        score: nextScore,
        round: nextRound,
        options,
        preferences,
        selectedStat,
        resultMessage: message,
        resultClass: isCorrect ? 'ok' : 'bad'
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
