import { describe, it, expect } from "vitest";
import {
  normalize,
  terms,
  stem,
  highlightExact,
  keywordScore,
  getMatchContext,
  chunksFor,
} from "./search.js";

describe("Search Integration Tests", () => {
  describe("End-to-end search workflow", () => {
    it("should find results for 'machine learning' query", () => {
      const query = "machine learning";
      const queryTerms = terms(query);

      expect(queryTerms).toContain("machine");
      expect(queryTerms).toContain("learning");

      const page = {
        title: "Machine Learning Engineering",
        description: "Build machine learning systems",
        keywords: ["machine-learning", "ai", "deep-learning"],
        tags: ["python", "tensorflow"],
        body: "This course covers machine learning fundamentals",
      };

      const score = keywordScore(page, queryTerms);
      expect(score).toBeGreaterThan(0);

      const context = getMatchContext(page, queryTerms);
      expect(context.length).toBeGreaterThan(0);
    });

    it("should correctly rank multiple results by relevance", () => {
      const queryTerms = terms("data analytics");

      const page1 = {
        title: "Data Analytics Platform",
        description: "Analytics dashboard",
        keywords: ["data", "analytics", "visualization"],
        tags: [],
        body: "Advanced analytics",
      };

      const page2 = {
        title: "General Blog",
        description: "A blog about various topics",
        keywords: [],
        tags: [],
        body: "I discussed data analytics in this post about analytics tools",
      };

      const score1 = keywordScore(page1, queryTerms);
      const score2 = keywordScore(page2, queryTerms);

      expect(score1).toBeGreaterThan(score2);
    });

    it("should handle typos and stemming correctly", () => {
      const query = "engineering";
      const queryTerms = terms(query);
      const stemmedTerms = queryTerms.map(stem);

      const page = {
        title: "Engineers at Work",
        description: "Professional engineers",
        keywords: ["engineer", "engineering"],
        tags: [],
        body: "Learn about engineers",
      };

      const score = keywordScore(page, stemmedTerms);
      expect(score).toBeGreaterThan(0);
    });

    it("should highlight matching terms in results", () => {
      const query = "python programming";
      const highlighted = highlightExact("Python is great for programming", query);

      expect(highlighted).toContain("<mark>Python</mark>");
      expect(highlighted).toContain("<mark>programming</mark>");
    });

    it("should not highlight partial word matches", () => {
      const query = "engineer";
      const highlighted = highlightExact("This is engineering work", query);

      expect(highlighted).not.toContain("<mark>engineer");
    });

    it("should handle special characters in search query", () => {
      const query = "data-science & AI";
      const queryTerms = terms(query);

      expect(queryTerms).toContain("data-science");
      expect(queryTerms).toContain("ai");
    });
  });

  describe("Content chunking for semantic search", () => {
    it("should create chunks for long documents", () => {
      const page = {
        title: "Long Article",
        description: "A comprehensive guide",
        keywords: ["guide", "reference"],
        tags: ["tutorial"],
        body: "A".repeat(5000),
      };

      const chunks = chunksFor(page);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeGreaterThan(0);
      });
    });

    it("should include metadata in chunks", () => {
      const page = {
        title: "Quick Reference",
        description: "Essential information",
        keywords: ["api", "documentation"],
        tags: ["tech"],
        body: "Details about the API",
      };

      const chunks = chunksFor(page);
      expect(chunks[0]).toContain("Quick Reference");
      expect(chunks[0]).toContain("Essential information");
      expect(chunks[0]).toContain("api");
    });

    it("should handle empty body text", () => {
      const page = {
        title: "Title Only",
        description: "",
        keywords: [],
        tags: [],
        body: "",
      };

      const chunks = chunksFor(page);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("Title Only");
    });
  });

  describe("Search result relevance scenarios", () => {
    it("should prioritize title matches over description", () => {
      const queryTerms = terms("strategic");
      const stemmedTerms = queryTerms.map(stem);

      const page1 = {
        title: "Strategic Planning",
        description: "General content",
        keywords: [],
        tags: [],
        body: "",
      };

      const page2 = {
        title: "General Article",
        description: "Discusses strategic approach to problems",
        keywords: [],
        tags: [],
        body: "",
      };

      expect(keywordScore(page1, stemmedTerms)).toBeGreaterThan(
        keywordScore(page2, stemmedTerms)
      );
    });

    it("should consider keyword field importance", () => {
      const queryTerms = terms("consulting");

      const page1 = {
        title: "Experience",
        description: "Background",
        keywords: ["consulting", "strategy", "business"],
        tags: [],
        body: "",
      };

      const page2 = {
        title: "Blog",
        description: "General content",
        keywords: [],
        tags: [],
        body: "I did some consulting work on a project",
      };

      expect(keywordScore(page1, queryTerms)).toBeGreaterThan(
        keywordScore(page2, queryTerms)
      );
    });

    it("should match across multiple query terms", () => {
      const queryTerms = ["data", "science"];

      const page = {
        title: "Data Science Guide",
        description: "Learn data science",
        keywords: ["machine learning"],
        tags: ["analytics"],
        body: "",
      };

      const score = keywordScore(page, queryTerms);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("Stop word filtering", () => {
    it("should filter common stop words", () => {
      const queryTerms = terms("the quick brown fox");

      expect(queryTerms).not.toContain("the");
      expect(queryTerms).toContain("quick");
      expect(queryTerms).toContain("brown");
      expect(queryTerms).toContain("fox");
    });

    it("should extract meaningful terms from natural language", () => {
      const query = "what is machine learning?";
      const queryTerms = terms(query);

      expect(queryTerms).not.toContain("what");
      expect(queryTerms).not.toContain("is");
      expect(queryTerms).toContain("machine");
      expect(queryTerms).toContain("learning");
    });
  });
});
