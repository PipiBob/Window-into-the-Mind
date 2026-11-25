export const ROLES = ['objective', 'novelty', 'method', 'result', 'caveat'];
export const LABELS = {objective:'Objective', novelty:'Contribution', method:'Method', result:'Result', caveat:'Caveat'};
export function defaultState(candidates) {
  const quantities = {};
  for (const role of ROLES) quantities[role] = candidates.filter(c => c.role === role && c.default_selected).length;
  return {quantities, enabled: new Set(ROLES), overrides: new Map(), skimming:true, selected:null};
}
export function ranked(candidates) { return [...candidates].sort((a,b) => a.rank-b.rank || a.id.localeCompare(b.id)); }
export function selectedIds(candidates, state) {
  const ids = new Set();
  for (const role of ROLES) {
    if (!state.enabled.has(role)) continue;
    for (const c of ranked(candidates.filter(c => c.role === role)).slice(0,state.quantities[role])) ids.add(c.id);
  }
  for (const c of candidates) {
    if (!state.enabled.has(c.role)) continue;
    if (state.overrides.get(c.id) === true) ids.add(c.id);
    if (state.overrides.get(c.id) === false) ids.delete(c.id);
  }
  return ids;
}
export function blockChoices(block, candidates, state) {
  const visible = selectedIds(candidates,state);
  const pool = ranked(candidates.filter(c => block.candidate_ids.includes(c.id) && state.enabled.has(c.role)));
  return {add:pool.find(c=>!visible.has(c.id)), remove:pool.filter(c=>visible.has(c.id)).at(-1)};
}
