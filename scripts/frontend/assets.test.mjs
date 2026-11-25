import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
    const ids = papers.filter(paper => paper.redistribution || (stage === 'study' &&
      existsSync(new URL(paper.pdf_path, root)) &&
      existsSync(new URL(`research/semantic-guided-skimming/${paper.id}-annotations.json`, root)))).map(p => p.id);
    assert.deepEqual(catalog.map(p => p.id), ids);
    for (const entry of catalog) {
      const paper = papers.find(p => p.id === entry.id);
      assert.equal(hash(read(`.frontend-${stage}-assets/${entry.annotations}`)), paper.annotations_sha256);
      assert.equal(hash(read(`.frontend-${stage}-assets/${entry.pdf}`)), paper.pdf_sha256);
    }
  });
}
