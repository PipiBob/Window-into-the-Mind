import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ROLES,defaultState,selectedIds,blockChoices} from '../web/selection.mjs';
const {candidates,blocks}=JSON.parse(fs.readFileSync(new URL('../demo/programming/annotations.json',import.meta.url)));
const s=defaultState(candidates);
assert.equal(selectedIds(candidates,s).size,13);
let prev=new Set();
for(let d=0;d<=100;d++){
 for(const r of ROLES)s.quantities[r]=Math.round(candidates.filter(c=>c.role===r).length*d/100);
 const next=selectedIds(candidates,s);assert([...prev].every(x=>next.has(x)));prev=next;
}
assert.equal(prev.size,candidates.length);
s.enabled.delete('method');assert([...selectedIds(candidates,s)].every(id=>candidates.find(c=>c.id===id).role!=='method'));
const fresh=defaultState(candidates),block=blocks.find(b=>blockChoices(b,candidates,fresh).add);
const {add}=blockChoices(block,candidates,fresh);fresh.overrides.set(add.id,true);assert(selectedIds(candidates,fresh).has(add.id));
for(const role of ROLES)fresh.quantities[role]=0;
assert(selectedIds(candidates,fresh).has(add.id));fresh.enabled.delete(add.role);assert(!selectedIds(candidates,fresh).has(add.id));
fresh.enabled.add(add.role);fresh.overrides.set(add.id,false);assert(!selectedIds(candidates,fresh).has(add.id));
console.log('Selection tests passed: defaults, monotonic density, filters, local overrides, exhaustion.');
