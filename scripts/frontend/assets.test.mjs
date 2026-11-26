import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const parse = name => JSON.parse(read(name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

for (const [stage, flags] of [['study', []], ['pages', ['--pages']]]) {
  test(`${stage} staging uses current, digest-pinned sources`, () => {
    execFileSync(process.execPath, ['scripts/frontend/prepare-assets.mjs', ...flags], {cwd: root});
    const {papers} = parse('research/semantic-guided-skimming/papers.json');
    const catalog = parse(`.frontend-${stage}-assets/demo/papers.json`);
    assert.deepEqual(catalog.map(entry => entry.id), papers.map(paper => paper.id));
    for (const entry of catalog) {
      const paper = papers.find(paper => paper.id === entry.id);
      const guide = paper.remote_guide ?? paper.local_guide;
      assert.equal(hash(read(`.frontend-${stage}-assets/${entry.annotations}`)), guide.sha256);
      if (paper.remote_guide) {
        assert.equal(entry.pdf, paper.remote_pdf);
        assert.equal(entry.translations, undefined);
      } else {
        assert.equal(hash(read(`.frontend-${stage}-assets/${entry.pdf}`)), paper.pdf_sha256);
        assert.equal(parse(`.frontend-${stage}-assets/${entry.translations}`).annotationSha256, guide.sha256);
      }
    }
  });
}
