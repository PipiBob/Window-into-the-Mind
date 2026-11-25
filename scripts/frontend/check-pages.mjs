import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';

const read = filename => JSON.parse(readFileSync(new URL(`../../${filename}`, import.meta.url)));
const {papers} = read('research/semantic-guided-skimming/papers.json');
const allowed = papers.filter(paper => paper.redistribution === true || paper.remote_pdf).map(paper => paper.id).sort();
const catalog = read('dist-pages/demo/papers.json');
assert.deepEqual(catalog.map(paper => paper.id).sort(), allowed);
assert.deepEqual(readdirSync(new URL('../../dist-pages/demo/', import.meta.url)).sort(), [...allowed, 'papers.json'].sort());
for (const entry of catalog) {
  const paper = papers.find(paper => paper.id === entry.id);
  const remote = paper.redistribution !== true;
  const localPdf = `demo/${entry.id}/source.pdf`;
  assert.equal(entry.pdf, remote ? paper.remote_pdf : localPdf);
  assert.equal(entry.annotations, `demo/${entry.id}/academic-skimming-v3${remote ? '-reference' : ''}.json`);
  const guide = read(`dist-pages/${entry.annotations}`);
  assert.equal(guide.provenance.skill, 'academic-skimming/3');
  if (remote) {
    assert(!existsSync(new URL(`../../dist-pages/${localPdf}`, import.meta.url)));
    assert.deepEqual(readdirSync(new URL(`../../dist-pages/demo/${entry.id}/`, import.meta.url)),
      [entry.annotations.split('/').at(-1)]);
    assert(guide.candidates.every(candidate => candidate.anchors.every(anchor =>
      !anchor.text && (anchor.region || anchor.text_range))));
  }
}
console.log('Pages artifact has local cleared PDFs and source references for externally hosted papers.');
