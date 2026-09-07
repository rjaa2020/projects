const form = document.getElementById("search-form");

if (form) {
  const pages = JSON.parse(form.dataset.searchIndex);
  const input = document.getElementById("search-input");
  const button = form.querySelector("button");
  const popover = document.getElementById("search-popover");
  const meta = document.getElementById("search-meta");
  const results = document.getElementById("search-results");
  const empty = document.getElementById("search-empty");
  let contentLoaded;
  let embedder;
  let semanticInitialization;
  let searching = false;

  const stopWords = new Set(["a", "an", "and", "are", "for", "how", "in", "is", "of", "on", "or", "the", "to", "what", "why"]);
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const terms = (value) => normalize(value).split(/\s+/).filter((term) => term.length > 1 && !stopWords.has(term));
  const stem = (term) => term.replace(/(ies|ing|ed|es|s)$/, (ending) => ending === "ies" ? "y" : "");
  const date = (value) => new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });

  async function loadSiteContent() {
    if (contentLoaded) return contentLoaded;
    contentLoaded = Promise.all(pages.map(async (page) => {
      if (!page.fetchUrl) return;
      const response = await fetch(page.fetchUrl);
      if (!response.ok) return;
      const document = new DOMParser().parseFromString(await response.text(), "text/html");
      page.body = document.querySelector("main")?.innerText || "";
    }));
    return contentLoaded;
  }

  function keywordScore(page, queryTerms) {
    const fields = [
      [page.title, 12],
      [page.tags.join(" "), 9],
      [page.description, 6],
      [page.body, 1],
    ];
    return queryTerms.reduce((total, queryTerm) => {
      const queryStem = stem(queryTerm);
      return total + fields.reduce((fieldTotal, [value, weight]) => {
        const fieldTerms = terms(value || "").map(stem);
        return fieldTotal + (fieldTerms.includes(queryStem) ? weight : 0);
      }, 0);
    }, 0);
  }

  function renderResults(ranked, label, statusText) {
    results.innerHTML = ranked.map((page) => `
      <article class="search-result">
        <div class="post-list-title"><a href="${page.url}">${page.title}</a></div>
        ${page.date ? `<div class="post-list-date">${date(page.date)}</div>` : ""}
        <p class="post-list-desc">${page.description}</p>
        ${page.tags.length ? `<div class="tag-row">${page.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>` : ""}
      </article>
    `).join("");
    meta.textContent = statusText || `${ranked.length} ${label}${ranked.length === 1 ? "" : "s"}`;
    empty.hidden = ranked.length > 0;
  }

  function keywordResults(query) {
    const queryTerms = terms(query);
    if (!queryTerms.length) return [];

    return pages.map((page) => ({ page, score: keywordScore(page, queryTerms) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.page.date.localeCompare(a.page.date))
      .map((result) => result.page);
  }

  function renderKeywordResults(query) {
    const ranked = keywordResults(query);
    if (!ranked.length) {
      results.innerHTML = "";
      empty.hidden = true;
      meta.textContent = "Type to search, or press Search for semantic results";
      return;
    }
    renderResults(ranked, "keyword result");
  }

  function chunksFor(page) {
    const text = [page.title, page.description, page.tags.join(" "), page.body].join("\n");
    const chunks = [];
    for (let start = 0; start < text.length; start += 1400) chunks.push(text.slice(start, start + 1600));
    return chunks;
  }

  function similarity(left, right) {
    return left.reduce((total, value, index) => total + value * right[index], 0);
  }

  async function initializeSemanticSearch() {
    if (semanticInitialization) return semanticInitialization;
    semanticInitialization = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
      await Promise.all(pages.map(async (page) => {
        page.embeddings = [];
        for (const chunk of chunksFor(page)) {
          const output = await embedder(chunk, { pooling: "mean", normalize: true });
          page.embeddings.push(Array.from(output.data));
        }
      }));
    })();
    return semanticInitialization;
  }

  async function runSemanticSearch(event) {
    event.preventDefault();
    if (searching) return;
    searching = true;
    button.disabled = true;
    popover.hidden = false;
    meta.textContent = "Loading semantic search...";
    try {
      await loadSiteContent();
      await initializeSemanticSearch();
      const query = await embedder(input.value, { pooling: "mean", normalize: true });
      const queryVector = Array.from(query.data);
      const semanticResults = pages.map((page) => ({
        page,
        score: Math.max(...page.embeddings.map((embedding) => similarity(queryVector, embedding))),
      }))
        .filter((result) => result.score > 0.25)
        .sort((a, b) => b.score - a.score)
        .map((result) => result.page);
      const keywordMatches = keywordResults(input.value);
      const keywordUrls = new Set(keywordMatches.map((page) => page.url));
      const semanticOnly = semanticResults.filter((page) => !keywordUrls.has(page.url));
      renderResults([...keywordMatches, ...semanticOnly], "result");
    } catch {
      meta.textContent = "Semantic search could not complete. Please try again.";
    } finally {
      searching = false;
      button.disabled = false;
    }
  }

  button.addEventListener("click", runSemanticSearch);
  form.addEventListener("submit", runSemanticSearch);
  input.addEventListener("focus", () => {
    popover.hidden = false;
    if (!input.value.trim()) meta.textContent = "Type to search, or press Search for semantic results";
  });
  input.addEventListener("input", () => {
    popover.hidden = false;
    renderKeywordResults(input.value);
    loadSiteContent().catch(() => {});
  });
  document.addEventListener("click", (event) => {
    if (!form.parentElement.contains(event.target)) popover.hidden = true;
  });
}
