import type {Block, Manifest, Role, Selection} from './types';

export const ROLES: Role[] = ['objective', 'novelty', 'method', 'result', 'caveat'];
export const LABELS: Record<Role, string> = {objective: 'Question', novelty: 'Contribution', method: 'Method', result: 'Finding', caveat: 'Limitation'};

export function defaultState(): Selection {
  return {mode: 'focus', enabled: new Set(ROLES), overrides: new Map(), selected: null, stopIndex: -1};
}

export function selectedIds(data: Manifest, state: Selection) {
  const ids = new Set<string>();
  if (state.mode === 'original') return ids;
  if (state.mode === 'focus') {
    for (const id of data.opening) ids.add(id);
    for (const stop of data.route) ids.add(stop.id);
    if (state.stopIndex >= 0) {
      for (const id of data.route[state.stopIndex].context) ids.add(id);
    }
  } else {
    for (const candidate of data.candidates) {
      if (state.enabled.has(candidate.role) && state.overrides.get(candidate.id) !== false) ids.add(candidate.id);
    }
  }
  if (state.selected) ids.add(state.selected);
  return ids;
}

export function blockChoices(block: Block, data: Manifest, state: Selection) {
  const available = data.candidates.filter(candidate => block.candidate_ids.includes(candidate.id)
    && state.enabled.has(candidate.role) && candidate.id !== state.selected);
  const ids = selectedIds(data, state);
  return {add: available.find(candidate => !ids.has(candidate.id)), remove: available.filter(candidate => ids.has(candidate.id)).at(-1)};
}
