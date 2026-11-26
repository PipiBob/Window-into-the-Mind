import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url));
const parse = path => JSON.parse(read(path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const {papers} = parse('research/semantic-guided-skimming/papers.json');
const allowed = papers.filter(paper => paper.redistribution || paper.remote_guide).map(paper => paper.id).sort();
const catalog = parse('dist-pages/demo/papers.json');
assert.deepEqual(catalog.map(entry => entry.id).sort(), allowed);
assert.deepEqual(readdirSync(new URL('../../dist-pages/demo/', import.meta.url)).sort(), [...allowed, 'papers.json'].sort());

for (const entry of catalog) {
  const paper = papers.find(p => p.id === entry.id);
  const remote = paper.redistribution !== true;
  const guide = remote ? paper.remote_guide : paper.local_guide;
  const bytes = read(`dist-pages/${entry.annotations}`);
  const annotations = JSON.parse(bytes);
  assert.equal(digest(bytes), guide.sha256);
  assert.equal(entry.skill, guide.skill);
  assert.equal(annotations.source.sha256, paper.pdf_sha256);
  const localPdf = `demo/${entry.id}/source.pdf`;
  if (remote) {
    assert.equal(entry.pdf, paper.remote_pdf);
    assert(!entry.translations);
    assert(!existsSync(new URL(`../../dist-pages/${localPdf}`, import.meta.url)));
    assert(annotations.candidates.every(c => c.anchors.every(a => !a.text && a.text_range)));
    assert.deepEqual(readdirSync(new URL(`../../dist-pages/demo/${entry.id}/`, import.meta.url)), [entry.annotations.split('/').at(-1)]);
  } else {
    assert.equal(entry.pdf, localPdf);
    assert.equal(digest(read(`dist-pages/${entry.pdf}`)), paper.pdf_sha256);
    const translations = parse(`dist-pages/${entry.translations}`);
    assert.equal(translations.annotationSha256, guide.sha256);
    assert(annotations.candidates.every(c => translations.passages[c.id]?.length === c.anchors.length));
  }
}
console.log('Verified the Pages catalog, cleared PDFs and translations, and quote-free external references.');
