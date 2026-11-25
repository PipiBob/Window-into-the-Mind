/** Stage a digest-pinned reader catalog and its public PDF.js runtime. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = path.join(root, 'research/semantic-guided-skimming');
const publicBuild = process.argv.includes('--pages');
const output = path.join(root, publicBuild ? '.frontend-pages-assets' : '.frontend-study-assets');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const {papers} = JSON.parse(await readFile(path.join(release, 'papers.json'), 'utf8'));
const allowed = papers.filter(paper => !publicBuild || paper.redistribution === true);
const library = [];
const bundles = [];
const ids = new Set();
for (const paper of allowed) {
  const {id, title} = paper;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate demo ID');
  ids.add(id);
  let pdf, annotations;
  try {
    [pdf, annotations] = await Promise.all([
      readFile(path.join(root, paper.pdf_path)),
      readFile(path.join(release, `${id}-annotations.json`)),
    ]);
  } catch (error) {
    if (paper.redistribution !== true && error.code === 'ENOENT') {
      console.log(`Local-only assets unavailable for ${id}.`);
      continue;
    }
    throw error;
  }
  const manifest = JSON.parse(annotations);
  if (digest(pdf) !== paper.pdf_sha256 || digest(annotations) !== paper.annotations_sha256 ||
      manifest.id !== id || manifest.source.sha256 !== paper.pdf_sha256 ||
      manifest.provenance?.skill !== 'academic-skimming/3' || !manifest.semantic_regions?.length) {
    throw new Error(`Saved bundle integrity check failed: ${id}`);
  }
  const prefix = `demo/${id}`;
  const pdfName = `${prefix}/source.pdf`;
  const annotationName = `${prefix}/academic-skimming-v3.json`;
  bundles.push({prefix, pdfName, pdf, annotationName, annotations});
  library.push({id, title, shortTitle: manifest.shortTitle, skill: manifest.provenance.skill,
    pdf: pdfName, annotations: annotationName});
}
if (!bundles.length) throw new Error('Demo catalog is empty');
for (const {prefix, pdfName, pdf, annotationName, annotations} of bundles) {
  await mkdir(path.join(output, prefix), {recursive: true});
  await writeFile(path.join(output, pdfName), pdf);
  await writeFile(path.join(output, annotationName), annotations);
}
await writeFile(path.join(output, 'demo/papers.json'), JSON.stringify(library, null, 2) + '\n');
await cp(path.join(root, 'research/phase-4/web/vendor'), path.join(output, 'vendor'), {recursive: true});
const notices = allowed.map(({id,title,authors,year,source_url,license}) =>
  ({id,title,authors,year,source_url,license}));
await writeFile(path.join(output, 'PUBLIC-PAPERS.json'), JSON.stringify({papers: notices}, null, 2) + '\n');
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Staged ${bundles.length} ${publicBuild ? 'redistribution-cleared' : 'local'} demo bundles.`);
