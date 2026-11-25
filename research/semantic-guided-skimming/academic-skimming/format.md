# Local PDF alignment

Use Python 3 with PyMuPDF. The script exposes original page text and resolves one JSON plan. No network service is involved.

```sh
python scripts/resolve.py paper.pdf text > pages.txt
python scripts/resolve.py paper.pdf resolve plan.json > annotations.json
```

A plan has a paper `id`, `shortTitle`, `opening` (candidate IDs to show at entry), optional `opening_note`, `candidates`, and `route` (ordered stops). A stop uses a candidate `id`, short `title`, `context` IDs, and an optional plain-language `note`. Candidates use `id`, `label`, `anchors`, and optional `related_to` IDs. For the Window into the Mind export set a `role` using the reader’s colors (`objective`, `method`, `result`, `novelty`, or `caveat`).

A text anchor is `{"page": 2, "quote": "The exact original sentence."}`. The file uses 1-based PDF pages. The resolver matches original text after collapsing whitespace, so keep original punctuation, Unicode and printed line-break hyphens. Add `within: [start, end]` for a repeated quote, using character offsets in the corresponding page’s raw text. A visually inspected figure anchor uses `{"page": 2, "region": "Figure 1 with caption", "box": [0.1, 0.2, 0.8, 0.5]}`. The box is normalized to visible page width and height, measured from the top left.

The result copies original glyph text into the resolved anchors and includes normalized line boxes, a source SHA-256, and links for the reader. Figure labels and explanatory notes are editorial. An unresolved quote or invalid region stops the export so it can be reviewed against the source. On a scanned page, an inspected region can provide a source link while exact textual alignment remains unavailable.

## Semantic regions

An optional `semantic_regions` array adds landmarks separate from text and figure anchors. Each item has `id`, `label`, `target` (candidate ID), and a source extent with `page` and either a verbatim `quote` or a visually verified normalized `box`. A text extent resolves to the bounding rectangle of its source lines. Use a coherent page-local extent and split across columns or pages where needed. The target must have an anchor on that page. The resolver emits the rectangle and target anchor index. Overlapping regions fail verification.
