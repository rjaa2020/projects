// Core search utilities that can be tested independently

const stopWords = new Set(["a", "an", "and", "are", "for", "how", "in", "is", "of", "on", "or", "the", "to", "what", "why"]);
const synonymGroups = [
  ["ngo", "nonprofit", "non-profit"],
];

export const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");

export const terms = (value) => normalize(value).split(/\s+/).filter((term) => term.length > 1 && !stopWords.has(term));

export const stem = (term) => term.replace(/(ies|ing|ed|es|s)$/, (ending) => ending === "ies" ? "y" : "");

const equivalentTerms = (term) => synonymGroups.find((group) => group.includes(term)) || [term];

export const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

export const highlightExact = (value, query) => {
  const escapedValue = escapeHtml(value || "");
  const queryWords = [...new Set(terms(query).flatMap(equivalentTerms))]
    .sort((left, right) => right.length - left.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!queryWords.length) return escapedValue;
  return escapedValue.replace(new RegExp(`\\b(${queryWords.join("|")})\\b`, "gi"), "<mark>$1</mark>");
};

export const keywordScore = (page, queryTerms) => {
  const fields = [
    [page.title, 12],
    [page.keywords?.join(" ") || "", 10],
    [page.tags?.join(" ") || "", 9],
    [page.description, 6],
    [page.body || "", 1],
  ];
  return queryTerms.reduce((total, queryTerm) => {
    const queryStems = equivalentTerms(queryTerm).map(stem);
    return total + fields.reduce((fieldTotal, [value, weight]) => {
      const fieldTerms = terms(value || "").map(stem);
      return fieldTotal + (queryStems.some((queryStem) => fieldTerms.includes(queryStem)) ? weight : 0);
    }, 0);
  }, 0);
};

export const getMatchContext = (page, queryTerms) => {
  const stemmedTerms = queryTerms.flatMap((term) => equivalentTerms(term).map(stem));
  const titleTerms = terms(page.title).map(stem);
  const keywordTerms = terms((page.keywords || []).join(" ")).map(stem);
  const tagTerms = terms((page.tags || []).join(" ")).map(stem);
  const matchedIn = [];
  if (stemmedTerms.some((t) => titleTerms.includes(t))) matchedIn.push("title");
  if (stemmedTerms.some((t) => keywordTerms.includes(t))) matchedIn.push("keywords");
  if (stemmedTerms.some((t) => tagTerms.includes(t))) matchedIn.push("tags");
  return matchedIn;
};

export const similarity = (left, right) => {
  return left.reduce((total, value, index) => total + value * right[index], 0);
};

export const chunksFor = (page) => {
  const text = [page.title, page.keywords?.join(" ") || "", page.description, page.tags?.join(" ") || "", page.body || ""].join("\n");
  const chunks = [];
  for (let start = 0; start < text.length; start += 1400) chunks.push(text.slice(start, start + 1600));
  return chunks;
};
