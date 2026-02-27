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
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${pathname} failed (${response.status}): ${text}`);
  }

  return response.json();
}

function renderPage({ prompt, score, round, resultMessage, resultClass }) {
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

      <div class="meta">Round: ${round} | Score: ${score}</div>
      <div class="prompt">${safePrompt}</div>

      <form method="post" action="/check">
        <label for="answer">Enter 4 notes in order</label>
        <input id="answer" name="answer" type="text" placeholder="C E G B or C,E,G,B" autofocus required />

        <div class="actions">
          <button type="submit">Submit</button>
          <a class="link-btn" href="/">Restart</a>
        </div>
      </form>

      ${resultHtml}
      <p class="footer-note">Use spaces or commas between notes.</p>
    </main>
  </body>
</html>`;
}

app.get('/', async (req, res) => {
  try {
    const prompt = await callApi('/prompt', {});
    req.session.prompt = prompt;
    req.session.score = 0;
    req.session.round = 1;

    res.send(
      renderPage({
        prompt,
        score: 0,
        round: 1,
        resultMessage: '',
        resultClass: ''
      })
    );
  } catch (error) {
    res.status(500).send(`Failed to initialize quiz: ${error.message}`);
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

    const check = await callApi('/check', {
      symbol: currentPrompt.symbol,
      notes: currentPrompt.notes,
      answer
    });
    const isCorrect = Boolean(check.is_correct);

    const nextPrompt = await callApi('/prompt', {});
    const nextScore = isCorrect ? score + 1 : score;
    const nextRound = round + 1;

    req.session.prompt = nextPrompt;
    req.session.score = nextScore;
    req.session.round = nextRound;

    const message = isCorrect
      ? `Correct. ${currentPrompt.symbol} = ${currentPrompt.notes.join(', ')}`
      : `Not quite. ${currentPrompt.symbol} = ${currentPrompt.notes.join(', ')}`;

    res.send(
      renderPage({
        prompt: nextPrompt,
        score: nextScore,
        round: nextRound,
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
