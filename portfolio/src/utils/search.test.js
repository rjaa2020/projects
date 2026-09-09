import { describe, it, expect } from "vitest";
import {
  normalize,
  terms,
  stem,
  escapeHtml,
  highlightExact,
  keywordScore,
  getMatchContext,
  similarity,
  chunksFor,
} from "./search.js";

describe("Search Utilities", () => {
  describe("normalize", () => {
    it("should lowercase text", () => {
      expect(normalize("HELLO WORLD")).toBe("hello world");
    });

    it("should remove special characters", () => {
      expect(normalize("Hello, World!")).toBe("hello  world ");
    });

    it("should remove punctuation but keep hyphens", () => {
      expect(normalize("data-engineering")).toBe("data-engineering");
    });

    it("should handle mixed content", () => {
      expect(normalize("Forward-Deploy'd Engineer (2024)")).toBe("forward-deploy d engineer  2024 ");
    });
  });

  describe("terms", () => {
    it("should split normalized text into terms", () => {
      expect(terms("hello world")).toEqual(["hello", "world"]);
    });

    it("should filter out stop words", () => {
      expect(terms("the quick brown fox")).toEqual(["quick", "brown", "fox"]);
    });

    it("should filter terms shorter than 2 chars", () => {
      expect(terms("a very good day")).toEqual(["very", "good", "day"]);
    });

    it("should handle empty strings", () => {
      expect(terms("")).toEqual([]);
    });

    it("should extract compound terms with hyphens", () => {
      expect(terms("data-engineering machine-learning")).toEqual(["data-engineering", "machine-learning"]);
    });
  });

  describe("stem", () => {
    it("should remove plural 's'", () => {
      expect(stem("engineers")).toBe("engineer");
    });

    it("should handle 'ies' to 'y'", () => {
      expect(stem("strategies")).toBe("strategy");
    });

    it("should remove 'ing'", () => {
      expect(stem("engineering")).toBe("engineer");
    });

    it("should remove 'ed'", () => {
      expect(stem("deployed")).toBe("deploy");
    });

    it("should handle 'es' ending", () => {
      expect(stem("passes")).toBe("pass");
    });

    it("should not modify words without common endings", () => {
      expect(stem("data")).toBe("data");
    });
  });

  describe("escapeHtml", () => {
    it("should escape ampersands", () => {
      expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    });

    it("should escape angle brackets", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    });

    it("should escape quotes", () => {
      expect(escapeHtml('He said "Hello"')).toBe("He said &quot;Hello&quot;");
    });

    it("should handle empty strings", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("should escape mixed HTML", () => {
      expect(escapeHtml('<div data-id="123">Content & Code</div>')).toBe(
        "&lt;div data-id=&quot;123&quot;&gt;Content &amp; Code&lt;/div&gt;"
      );
    });
  });

  describe("highlightExact", () => {
    it("should highlight exact word matches with word boundaries", () => {
      const result = highlightExact("Learning machine learning", "learning");
      expect(result).toContain("<mark>Learning</mark>");
      expect(result).toContain("<mark>learning</mark>");
    });

    it("should not highlight partial matches", () => {
      const result = highlightExact("engineering", "engineer");
      expect(result).not.toContain("<mark>");
    });

    it("should escape HTML before highlighting", () => {
      const result = highlightExact("<script>analytics</script>", "analytics");
      expect(result).toContain("&lt;script&gt;");
      expect(result).toContain("<mark>analytics</mark>");
    });

    it("should handle multiple query terms", () => {
      const result = highlightExact("data science and machine learning", "data learning");
      expect((result.match(/<mark>/g) || []).length).toBe(2);
    });

    it("should return escaped text when no matches", () => {
      const result = highlightExact("hello world", "xyz");
      expect(result).toBe("hello world");
      expect(result).not.toContain("<mark>");
    });

    it("should highlight nonprofit when searching for ngo", () => {
      const result = highlightExact("A nonprofit founder", "ngo");
      expect(result).toContain("<mark>nonprofit</mark>");
    });
  });

  describe("keywordScore", () => {
    it("should score higher for title matches", () => {
      const page1 = {
        title: "Data Engineering",
        description: "Some description",
        keywords: [],
        tags: [],
        body: "",
      };
      const page2 = {
        title: "Other Page",
        description: "Data engineering platform",
        keywords: [],
        tags: [],
        body: "",
      };
      const queryTerms = terms("data engineering");
      expect(keywordScore(page1, queryTerms)).toBeGreaterThan(keywordScore(page2, queryTerms));
    });

    it("should score keyword matches", () => {
      const page = {
        title: "Experience",
        description: "My work",
        keywords: ["analytics", "data science", "consulting"],
        tags: [],
        body: "",
      };
      const queryTerms = terms("analytics");
        expect(keywordScore(page, queryTerms)).toBeGreaterThan(0);
      });

      it("should score hyphenated tag matches", () => {
        const page = {
          title: "Article",
          description: "Content",
          keywords: [],
          tags: ["machine-learning", "python"],
          body: "",
        };
        const queryTerms = terms("machine-learning");
        expect(keywordScore(page, queryTerms)).toBeGreaterThan(0);
    });

    it("should score tag matches", () => {
      const page = {
        title: "Article",
        description: "Content",
        keywords: [],
        tags: ["machine-learning", "python"],
        body: "",
      };
      const queryTerms = terms("machine learning");
       expect(keywordScore(page, queryTerms)).toBe(0);
    });

    it("should score body text lowest", () => {
      const page = {
        title: "Title",
        description: "Description",
        keywords: [],
        tags: [],
        body: "data engineering content here",
      };
      const queryTerms = terms("data");
      expect(keywordScore(page, queryTerms)).toBeGreaterThan(0);
    });

    it("should return 0 for no matches", () => {
      const page = {
        title: "Title",
        description: "Description",
        keywords: [],
        tags: [],
        body: "Content",
      };
      const queryTerms = terms("xyz");
      expect(keywordScore(page, queryTerms)).toBe(0);
    });

    it("should match nonprofit pages when searching for ngo", () => {
      const page = {
        title: "Don't Be Broke",
        description: "A financial literacy project",
        keywords: ["nonprofit co-founder"],
        tags: [],
        body: "",
      };
      expect(keywordScore(page, terms("ngo"))).toBeGreaterThan(0);
    });
  });

  describe("getMatchContext", () => {
    it("should identify title matches", () => {
      const page = {
        title: "Machine Learning",
        description: "Content",
        keywords: [],
        tags: [],
      };
      const queryTerms = terms("machine");
      expect(getMatchContext(page, queryTerms)).toContain("title");
    });

    it("should identify keyword matches", () => {
      const page = {
        title: "Experience",
        description: "Content",
        keywords: ["data science", "analytics"],
        tags: [],
      };
      const queryTerms = terms("analytics");
      expect(getMatchContext(page, queryTerms)).toContain("keywords");
    });

    it("should identify tag matches", () => {
      const page = {
        title: "Article",
        description: "Content",
        keywords: [],
        tags: ["python", "machine-learning"],
      };
      const queryTerms = terms("python");
      expect(getMatchContext(page, queryTerms)).toContain("tags");
    });

    it("should return empty array for no matches", () => {
      const page = {
        title: "Article",
        description: "Content",
        keywords: [],
        tags: [],
      };
      const queryTerms = terms("xyz");
      expect(getMatchContext(page, queryTerms)).toEqual([]);
    });

    it("should identify multiple match locations", () => {
      const page = {
        title: "Analytics Platform",
        description: "Content",
        keywords: ["analytics"],
        tags: [],
      };
      const queryTerms = terms("analytics");
      const context = getMatchContext(page, queryTerms);
      expect(context).toContain("title");
      expect(context).toContain("keywords");
    });
  });

  describe("similarity", () => {
    it("should calculate dot product between vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0];
      expect(similarity(v1, v2)).toBe(1);
    });

    it("should return 0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(similarity(v1, v2)).toBe(0);
    });

    it("should handle partial overlap", () => {
      const v1 = [1, 1, 0];
      const v2 = [1, 1, 0];
      expect(similarity(v1, v2)).toBe(2);
    });

    it("should handle negative values", () => {
      const v1 = [1, -1, 0];
      const v2 = [1, 1, 0];
      expect(similarity(v1, v2)).toBe(0);
    });
  });

  describe("chunksFor", () => {
    it("should create chunks of content", () => {
      const page = {
        title: "Test",
        description: "A".repeat(100),
        keywords: [],
        tags: [],
        body: "B".repeat(3000),
      };
      const chunks = chunksFor(page);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should handle empty content", () => {
      const page = {
        title: "Test",
        description: "",
        keywords: [],
        tags: [],
        body: "",
      };
      const chunks = chunksFor(page);
      expect(chunks.length).toBe(1);
    });

    it("should create overlapping chunks", () => {
      const page = {
        title: "Test",
        description: "",
        keywords: [],
        tags: [],
        body: "A".repeat(2000),
      };
      const chunks = chunksFor(page);
      expect(chunks[0].length).toBe(1600);
    });

    it("should include keywords in chunks", () => {
      const page = {
        title: "Title",
        description: "Desc",
        keywords: ["keyword1", "keyword2"],
        tags: [],
        body: "Body",
      };
      const chunks = chunksFor(page);
      expect(chunks[0]).toContain("keyword");
    });
  });
});
