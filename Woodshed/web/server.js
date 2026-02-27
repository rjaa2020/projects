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
    scores: {}
  };
}

function scoreKey(root, quality) {
  return `${root}|${quality}`;
}

function scoreValue(scores, root, quality) {
  return Number(scores[scoreKey(root, quality)] || 0);
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

function renderMainPage({ prompt, score, round, resultMessage, resultClass, options, preferences }) {
  const safePrompt = prompt.symbol;
  const resultHtml = resultMessage
    ? `<div class="result ${resultClass}">${resultMessage}</div>`
    : '';

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
          <a class="link-btn" href="/stats">View Stats</a>
        </div>
      </form>

      <div class="meta">Round: ${round} | Score: ${score}</div>
      <div class="prompt">${safePrompt}</div>

      <form method="post" action="/check">
        <label for="answer">Enter 4 notes in order</label>
        <input id="answer" name="answer" type="text" placeholder="C E G B or C,E,G,B" autofocus required />

        <div class="actions">
          <button type="submit">Submit</button>
          <a class="link-btn" href="/">Restart</a>
          <a class="link-btn" href="/stats">Stats</a>
        </div>
      </form>

      ${resultHtml}
      <p class="footer-note">Use spaces or commas between notes.</p>
    </main>
  </body>
</html>`;
}

function renderStatsPage({ options, preferences }) {
  const headerCells = options.chord_qualities.map((quality) => `<th>${quality}</th>`).join('');
  const bodyRows = options.keys
    .map((root) => {
      const cells = options.chord_qualities
        .map((quality) => {
          const value = scoreValue(preferences.scores, root, quality);
          const colors = scoreColor(value);
          return `<td class="score-cell" style="background:${colors.background};color:${colors.foreground}">${value}</td>`;
        })
        .join('');
      return `<tr><th>${root}</th>${cells}</tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Woodshed Stats</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body>
    <main class="container">
      <h1>Woodshed Stats</h1>
      <p class="subtitle">Key × Chord Quality performance table</p>

      <div class="actions">
        <a class="link-btn" href="/">Back to Quiz</a>
        <form method="post" action="/clear-scores" class="inline-form"><button type="submit">Clear Score</button></form>
      </div>

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

      <p class="footer-note">0 = untested, +1 per correct answer, -1 per incorrect answer.</p>
    </main>
  </body>
</html>`;
}

app.get('/', async (req, res) => {
  try {
    const options = await callApi('/options');
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    req.session.preferences = preferences;

    const prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.prompt = prompt;
    req.session.score = 0;
    req.session.round = 1;

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
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
    req.session.score = 0;
    req.session.round = 1;

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
        resultMessage: 'Filters saved. Score cleared for new filter set.',
        resultClass: 'ok'
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to save filters: ${error.message}`);
  }
});

app.get('/stats', async (req, res) => {
  try {
    const options = await callApi('/options');
    const preferences = req.session.preferences || defaultPreferences(options);
    preferences.scores = preferences.scores || {};
    req.session.preferences = preferences;
    res.send(renderStatsPage({ options, preferences }));
  } catch (error) {
    res.status(500).send(`Failed to load stats page: ${error.message}`);
  }
});

app.post('/clear-scores', async (req, res) => {
  try {
    const options = await callApi('/options');
    const currentPreferences = req.session.preferences || defaultPreferences(options);
    const preferences = resetScores(currentPreferences);
    req.session.preferences = preferences;

    const prompt = await callApi('/prompt', buildPromptPayload(preferences));
    req.session.prompt = prompt;
    req.session.score = 0;
    req.session.round = 1;

    res.send(
      renderMainPage({
        prompt,
        score: 0,
        round: 1,
        options,
        preferences,
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

    const check = await callApi('/check', {
      symbol: currentPrompt.symbol,
      notes: currentPrompt.notes,
      answer,
      scores: preferences.scores
    });
    const isCorrect = Boolean(check.is_correct);
    preferences.scores = check.updated_scores || preferences.scores;

    const nextPrompt = await callApi('/prompt', buildPromptPayload(preferences));
    const nextScore = isCorrect ? score + 1 : score;
    const nextRound = round + 1;

    req.session.prompt = nextPrompt;
    req.session.score = nextScore;
    req.session.round = nextRound;
    req.session.preferences = preferences;

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
