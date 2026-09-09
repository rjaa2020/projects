# Search Testing Guide

This directory contains comprehensive unit and integration tests for the semantic search functionality.

## Test Files

### `search.js`
Core search utilities module containing testable functions for:
- **Text normalization & processing**: `normalize()`, `terms()`, `stem()`
- **HTML safety**: `escapeHtml()`
- **Highlighting**: `highlightExact()`
- **Keyword scoring**: `keywordScore()`, `getMatchContext()`
- **Vector operations**: `similarity()`
- **Content chunking**: `chunksFor()`

### `search.test.js`
Unit tests covering individual function behavior (44 tests):
- ✅ Text normalization and stemming
- ✅ Stop word filtering
- ✅ HTML entity escaping
- ✅ Word-boundary-aware highlighting
- ✅ Keyword field weighting
- ✅ Match context detection
- ✅ Vector similarity calculations
- ✅ Content chunking for semantic search

### `search.integration.test.js`
Integration tests covering end-to-end search workflows (14 tests):
- ✅ Multi-term query handling
- ✅ Result ranking and relevance
- ✅ Stemming and term matching
- ✅ Highlight accuracy
- ✅ Content chunking for long documents
- ✅ Field-level prioritization
- ✅ Stop word extraction from natural language

## Running Tests

### Watch Mode (Development)
```bash
npm test
```
Watches for file changes and re-runs tests automatically.

### Run Once (CI/CD)
```bash
npm run test:run
```
Single test run with exit code for CI pipelines.

### UI Dashboard
```bash
npm run test:ui
```
Opens Vitest UI for interactive test exploration.

## Test Coverage

Current coverage targets:
- **search.js**: All core functions
- **Test count**: 58 tests total (44 unit + 14 integration)
- **Pass rate**: 100%

## Key Test Scenarios

### Keyword Scoring
Tests verify that keyword matching uses weighted field importance:
- Title matches: weight 12 (highest priority)
- Keywords field: weight 10
- Tags: weight 9
- Description: weight 6
- Body text: weight 1 (lowest priority)

### Highlighting
Tests ensure:
- Only complete words are highlighted (word boundaries)
- Special characters are escaped for safety
- Case-insensitive matching
- No false positives on partial matches

### Stop Word Filtering
Tests verify these words are filtered: "a", "an", "and", "are", "for", "how", "in", "is", "of", "on", "or", "the", "to", "what", "why"

### Stemming
Tests cover transformations:
- "strategies" → "strategy" (ies → y)
- "engineers" → "engineer" (s removed)
- "engineering" → "engineer" (ing removed)
- "deployed" → "deploy" (ed removed)

## Debugging Test Failures

1. **Single Test**: `npm test -- --reporter=verbose search.test.js`
2. **Specific Suite**: `npm test -- -t "normalize"`
3. **Debug**: Add `console.log()` to test file, run `npm test`
4. **UI Mode**: `npm run test:ui` for interactive debugging

## Adding New Tests

1. Create test in appropriate file (`.test.js` for unit, `.integration.test.js` for integration)
2. Use `describe()` for test suites, `it()` for individual tests
3. Follow existing patterns for consistency
4. Run `npm run test:run` to validate

Example:
```javascript
describe("New Feature", () => {
  it("should do something specific", () => {
    const result = myFunction("input");
    expect(result).toBe("expected");
  });
});
```

## Performance Notes

- All tests run in **~160ms**
- No external API calls (pure functions)
- Happy DOM environment for DOM-related tests
- Fully deterministic (no flaky tests)

## CI/CD Integration

Tests can be integrated into CI/CD pipelines:
```yaml
test:
  script: npm run test:run
  artifacts:
    reports:
      coverage: coverage/
```

## Maintenance

- Review tests when updating `search.js`
- Keep tests in sync with function changes
- Update integration tests when search algorithm changes
- Monitor test runtime for performance regressions
