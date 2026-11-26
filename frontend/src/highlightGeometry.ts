import type {Box, Candidate, Role} from './types';

interface TextBox {box: Box; id: string; role: Role; priority: number; anchorIndex: number; start: boolean; end: boolean}
interface Stroke {box: Box; id: string; role: Role; focused: boolean; anchorIndex: number; start: boolean; end: boolean; source: Box}
const height = ({box}: TextBox) => box[3] - box[1];
const center = ({box}: TextBox) => (box[1] + box[3]) / 2;
const sameLine = (a: TextBox, b: TextBox) =>
  Math.abs(center(a) - center(b)) <= Math.min(height(a), height(b)) * .24;

function textBoxes(candidates: Candidate[], page: number, primary: Set<string>, focused: string | null) {
  return candidates.flatMap((candidate, index) => candidate.anchors.flatMap((anchor, anchorIndex) =>
    anchor.page === page && !anchor.region ? anchor.boxes.map((box, line) => ({
      box, id: candidate.id, role: candidate.role, anchorIndex, start: line === 0, end: line === anchor.boxes.length - 1,
      priority: index + (candidate.id === focused ? 0 : primary.has(candidate.id) ? 1 : 2) * candidates.length,
    })) : []));
}

export function overlappingRoles(candidate: Candidate, candidates: Candidate[]) {
  const roles = new Set<Role>();
  for (const page of new Set(candidate.anchors.map(anchor => anchor.page))) {
    const boxes = textBoxes(candidates, page, new Set(), null);
    const own = boxes.filter(box => box.id === candidate.id);
    for (const other of boxes) {
      if (other.role !== candidate.role && own.some(item => sameLine(item, other) &&
        Math.min(item.box[2], other.box[2]) > Math.max(item.box[0], other.box[0]))) {
        roles.add(other.role);
      }
    }
  }
  return [...roles];
}

export function textStrokes(candidates: Candidate[], page: number, primary: Set<string>, focused: string | null,
  inkBounds?: (box: Box) => [number, number] | undefined) {
  const rows: TextBox[][] = [];
  for (const item of textBoxes(candidates, page, primary, focused).sort((a, b) => center(a) - center(b))) {
    const last = rows.at(-1);
    if (last && sameLine(last[0], item)) last.push(item);
    else rows.push([item]);
  }

  return rows.flatMap((row, index): Stroke[] => {
    // Saved line bounds include font ascenders and descenders and can exceed line spacing.
    const middle = center(row[Math.floor(row.length / 2)]);
    const typicalHeight = row.map(height).sort((a, b) => a - b)[Math.floor(row.length / 2)];
    const top = Math.max(0, middle - typicalHeight * .34);
    const bottom = Math.min(1, middle + typicalHeight * .37);
    const edges = [...new Set(row.flatMap(({box}) => [box[0], box[2]]))].sort((a, b) => a - b);
    const ranked = [...row].sort((a, b) => a.priority - b.priority);
    const strokes: Stroke[] = [];
    for (let i = 1; i < edges.length; i++) {
      const left = edges[i - 1], right = edges[i];
      // Paint each interval once. The selected passage wins, then a guided stop.
      const winner = ranked.find(({box}) => box[0] <= left && box[2] >= right);
      if (!winner) continue;
      const active = winner.id === focused;
      const last = strokes.at(-1);
      const start = winner.start && left === winner.box[0];
      const end = winner.end && right === winner.box[2];
      if (last?.source === winner.box && last.box[2] === left) {
        last.box[2] = right;
        last.end = end;
      } else {
        strokes.push({box: [left, top, right, bottom], id: winner.id, role: winner.role,
          focused: active, anchorIndex: winner.anchorIndex, start, end, source: winner.box});
      }
    }
    for (const {box, source} of strokes) {
      const fitted = inkBounds?.([box[0], source[1], box[2], source[3]]);
      if (fitted) [box[1], box[3]] = fitted;
      // In a multi-column PDF, only a neighbouring row in the same x-range can collide.
      for (const [otherIndex, other] of rows.entries()) {
        if (otherIndex === index) continue;
        const neighbor = other.find(item => item.box[0] < box[2] && item.box[2] > box[0]);
        if (!neighbor) continue;
        const otherMiddle = center(other[Math.floor(other.length / 2)]);
        const separation = (middle + otherMiddle) / 2;
        if (otherIndex < index) box[1] = Math.max(box[1], separation);
        else box[3] = Math.min(box[3], separation);
      }
    }
    return strokes.filter(({box}) => box[3] > box[1]);
  });
}
