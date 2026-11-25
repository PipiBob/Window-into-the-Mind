import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const read = filename => JSON.parse(readFileSync(new URL(`../../${filename}`, import.meta.url)));
const {papers} = read('research/semantic-guided-skimming/papers.json');
const allowed = papers.filter(paper => paper.redistribution === true).map(paper => paper.id).sort();
const catalog = read('dist-pages/demo/papers.json');
assert.deepEqual(catalog.map(paper => paper.id).sort(), allowed);
assert.deepEqual(readdirSync(new URL('../../dist-pages/demo/', import.meta.url)).sort(), [...allowed, 'papers.json'].sort());
for (const entry of catalog) {
  assert.equal(entry.annotations, `demo/${entry.id}/academic-skimming-v3.json`);
  assert.equal(entry.pdf, `demo/${entry.id}/source.pdf`);
  assert.equal(read(`dist-pages/${entry.annotations}`).provenance.skill, 'academic-skimming/3');
}
console.log('Pages artifact contains only cleared demo assets.');
