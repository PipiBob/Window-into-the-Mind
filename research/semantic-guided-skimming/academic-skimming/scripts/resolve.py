"""Align a lightweight reading path to the original PDF."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

import pymupdf


def source_page(page):
    characters, glyphs = [], []
    for block in page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]:
        for line in block.get("lines", []):
            line_id = len(characters)
            for span in line["spans"]:
                for glyph in span["chars"]:
                    for char in glyph["c"]:
                        characters.append(char)
                        glyphs.append((line_id, glyph["bbox"]))
            characters.append("\n")
            glyphs.append(None)
    return "".join(characters), glyphs


def searchable(text):
    """Collapse whitespace only, retaining offsets into the original text."""
    parts, offsets = [], []
    for match in re.finditer(r"\s+|\S", text):
        parts.append(" " if match[0].isspace() else match[0])
        offsets.append((match.start(), match.end()))
    return "".join(parts), offsets


def rectangle(page, bounds):
    box = pymupdf.Rect(bounds) * page.rotation_matrix
    width, height = page.rect.width, page.rect.height
    return [round(value, 8) for value in
            (box.x0 / width, box.y0 / height, box.x1 / width, box.y1 / height)]


def resolve_text(page, source, quote, within=None):
    text, glyphs = source
    haystack, offsets = searchable(text)
    needle = searchable(quote.strip())[0]
    if not needle:
        raise ValueError("empty quote")
    matches = []
    for match in re.finditer("(?=" + re.escape(needle) + ")", haystack):
        start = offsets[match.start()][0]
        stop = offsets[match.start() + len(needle) - 1][1]
        if within and not within[0] <= start < stop <= within[1]:
            continue
        matches.append((start, stop))
    if len(matches) != 1:
        raise ValueError(f"{len(matches)} matches on page")
    start, stop = matches[0]
    lines = defaultdict(pymupdf.Rect)
    for char, glyph in zip(text[start:stop], glyphs[start:stop]):
        if glyph and not char.isspace():
            line, bounds = glyph
            lines[line] |= pymupdf.Rect(bounds)
    boxes = [rectangle(page, bounds) for bounds in lines.values()]
    if not boxes or not all(valid_box(box) for box in boxes):
        raise ValueError("text has missing or off-page geometry")
    return {"kind": "text", "status": "text_matched", "text": text[start:stop],
            "boxes": boxes, "offsets": [start, stop]}


def valid_box(box):
    return (isinstance(box, list) and len(box) == 4
            and all(type(value) in (int, float) for value in box)
            and 0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1)


VERSION = "academic-skimming/3"


def resolve(pdf, plan, fingerprint):
    candidates = []
    cache = {}
    ids = {c["id"] for c in plan["candidates"]}
    if len(ids) != len(plan["candidates"]):
        raise ValueError("duplicate candidate ID")
    if not set(plan["opening"]) <= ids:
        raise ValueError("unknown opening candidate")
    for stop in plan["route"]:
        if stop["id"] not in ids or not set(stop.get("context", [])) <= ids:
            raise ValueError(f"unknown route candidate at {stop['id']}")
    for candidate in plan["candidates"]:
        links = candidate.get("related_to", [])
        if not set(links) <= ids:
            raise ValueError(f"unknown related candidate at {candidate['id']}")
        anchors = []
        for anchor in candidate["anchors"]:
            number = anchor["page"]
            if type(number) is not int or not 1 <= number <= len(pdf):
                raise ValueError(f"invalid PDF page at {candidate['id']}")
            page = pdf[number - 1]
            if "quote" in anchor:
                if number not in cache:
                    cache[number] = source_page(page)
                try:
                    match = resolve_text(page, cache[number], anchor["quote"], anchor.get("within"))
                except ValueError as exc:
                    raise ValueError(f"{candidate['id']} on page {number}: {exc}") from exc
                anchors.append(dict(page=number, text=match["text"], boxes=match["boxes"]))
            else:
                if not anchor.get("region") or not valid_box(anchor.get("box")):
                    raise ValueError(f"invalid visual region at {candidate['id']}")
                anchors.append(dict(page=number, text="", boxes=[anchor["box"]], region=anchor["region"]))
        if not anchors:
            raise ValueError(f"missing anchors at {candidate['id']}")
        candidates.append({**candidate, "anchors": anchors, "related_to": links})

    blocks = []
    for number in cache:
        for index, source_block in enumerate(pdf[number - 1].get_text("blocks")):
            box = rectangle(pdf[number - 1], source_block[:4])
            members = []
            for candidate in candidates:
                for anchor in candidate["anchors"]:
                    if anchor["page"] == number and "region" not in anchor and any(
                        box[0] <= (b[0] + b[2]) / 2 <= box[2] and box[1] <= (b[1] + b[3]) / 2 <= box[3]
                        for b in anchor["boxes"]
                    ):
                        members.append(candidate["id"])
                        break
            if members and valid_box(box):
                blocks.append(dict(id=f"p{number}-b{index}", page=number, box=box, candidate_ids=members))

    regions = []
    by_id = {candidate["id"]: candidate for candidate in candidates}
    for region in plan.get("semantic_regions", []):
        region_id, page = region["id"], region["page"]
        target = by_id.get(region["target"], {})
        if type(page) is not int or not 1 <= page <= len(pdf) or not region["label"].strip():
            raise ValueError(f"invalid region {region_id}")
        if "quote" in region:
            match = resolve_text(pdf[page - 1], source_page(pdf[page - 1]), region["quote"])
            boxes = match["boxes"]
            box = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                   max(b[2] for b in boxes), max(b[3] for b in boxes)]
        else:
            box = region["box"]
        anchors = [i for i, anchor in enumerate(target.get("anchors", [])) if anchor["page"] == page]
        if not anchors or not valid_box(box):
            raise ValueError(f"invalid box or target for semantic region {region_id}")
        for previous in regions:
            a = previous["box"]
            if previous["id"] == region_id or (previous["page"] == page
                and min(a[2], box[2]) > max(a[0], box[0])
                and min(a[3], box[3]) > max(a[1], box[1])):
                raise ValueError(f"duplicate or overlapping semantic region {region_id}")
        # Prefer the target anchor nearest the source extent when a candidate
        # has multiple fragments on this page.
        def distance(i):
            return min(max(b[1] - box[3], box[1] - b[3], 0) +
                       max(b[0] - box[2], box[0] - b[2], 0)
                       for b in target["anchors"][i]["boxes"])

        regions.append(dict(id=region_id, page=page, label=region["label"], target=region["target"],
                            box=box, anchor_index=min(anchors, key=distance)))

    return {
        **plan, "candidates": candidates, "blocks": blocks, "semantic_regions": regions,
        "pages": list(range(1, len(pdf) + 1)),
        "source": {"sha256": fingerprint, "pages": len(pdf), "extractor": pymupdf.VersionBind},
        "provenance": {"skill": VERSION},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("text")
    resolver = commands.add_parser("resolve")
    resolver.add_argument("plan", type=Path)
    args = parser.parse_args()
    with pymupdf.open(args.pdf) as pdf:
        if args.command == "text":
            for page in pdf:
                print(f"\n=== PDF page {page.number + 1} ===")
                print(source_page(page)[0], end="")
        else:
            plan = json.loads(args.plan.read_text())
            result = resolve(pdf, plan, hashlib.sha256(args.pdf.read_bytes()).hexdigest())
            print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
