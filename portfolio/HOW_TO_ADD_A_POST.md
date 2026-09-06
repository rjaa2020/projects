# Adding a writing/blog post

Create a new markdown file in `src/content/writing/`, e.g. `src/content/writing/my-post.md`,
with frontmatter like this at the top:

```
---
title: "My Post Title"
description: "One sentence shown on the /writing list page."
pubDate: 2026-09-06
tags: ["ml", "data"]
---
```

Everything below the frontmatter is the post body, written in Markdown.

It will automatically appear at `/writing/my-post/` and in the list at `/writing/`, sorted
newest first. Add `draft: true` to the frontmatter to keep a post out of the published list
while you're still working on it.

Do not put any other files (README, notes, etc.) directly inside `src/content/writing/` —
Astro treats every `.md` file in that folder as a post and will fail to build if one is
missing the required frontmatter fields above.
