/** Stage a digest-pinned reader catalog and its public PDF.js runtime. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = path.join(root, 'research/semantic-guided-skimming');
const publicBuild = process.argv.includes('--pages');
const output = path.join(root, publicBuild ? '.frontend-pages-assets' : '.frontend-study-assets');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const {papers} = JSON.parse(await readFile(path.join(release, 'papers.json'), 'utf8'));
const allowed = papers.filter(paper => !publicBuild || paper.redistribution === true || paper.remote_guide);
const library = [];
const bundles = [];
const ids = new Set();
for (const paper of allowed) {
  const {id, title} = paper;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate demo ID');
  ids.add(id);
  const remote = publicBuild && paper.redistribution !== true;
  const guide = remote ? paper.remote_guide : paper.local_guide;
  const annotationsPath = guide ? path.join(root, guide.path) : path.join(release, `${id}-annotations.json`);
  let pdf, annotations;
  try {
    [pdf, annotations] = await Promise.all([
      remote ? null : readFile(path.join(root, paper.pdf_path)),
      readFile(annotationsPath),
    ]);
  } catch (error) {
    if (!publicBuild && paper.redistribution !== true && error.code === 'ENOENT') {
      console.log(`Local-only assets unavailable for ${id}.`);
      continue;
    }
    throw error;
  }
  const manifest = JSON.parse(annotations);
  if ((!remote && digest(pdf) !== paper.pdf_sha256) || digest(annotations) !== (guide?.sha256 ?? paper.annotations_sha256) ||
      manifest.id !== id || manifest.source.sha256 !== paper.pdf_sha256 ||
      manifest.provenance?.skill !== (guide?.skill ?? 'academic-skimming/3') || !manifest.opening?.length || !manifest.route?.length) {
    throw new Error(`Saved bundle integrity check failed: ${id}`);
  }
  const prefix = `demo/${id}`;
  const pdfName = remote ? paper.remote_pdf : `${prefix}/source.pdf`;
  const annotationName = `${prefix}/${manifest.provenance.skill.replace('/', '-v')}${remote ? '-reference' : ''}.json`;
  if (remote && (new URL(pdfName).protocol !== 'https:' || manifest.candidates.some(candidate =>
    candidate.anchors.some(anchor => anchor.text || (!anchor.region && !anchor.text_range))))) {
    throw new Error(`Invalid external source or quote-bearing public reference: ${id}`);
  }
  const translations = remote ? null : await readFile(annotationsPath.replace(/\.json$/, '-zh-CN.json'));
  if (translations) {
    const localized = JSON.parse(translations);
    const passages = localized.passages ?? {};
    if (localized.annotationSha256 !== digest(annotations) ||
        Object.keys(passages).length !== manifest.candidates.length ||
        manifest.candidates.some(({id, anchors}) =>
          !Array.isArray(passages[id]) || passages[id].length !== anchors.length ||
          passages[id].some(text => typeof text !== 'string' || !/[\u3400-\u9fff]/u.test(text)))) {
      throw new Error(`Chinese translations do not match saved highlights: ${id}`);
    }
  }
  const translationName = annotationName.replace(/\.json$/, '-zh-CN.json');
  bundles.push({prefix, pdfName, pdf, annotationName, annotations, translationName, translations});
  library.push({id, title, shortTitle: manifest.shortTitle, skill: manifest.provenance.skill,
    pdf: pdfName, annotations: annotationName, ...(translations ? {translations: translationName} : {})});
}
if (!bundles.length) throw new Error('Demo catalog is empty');
const demo = path.join(output, 'demo');
await mkdir(demo, {recursive: true});
const activePaths = new Set([
  'papers.json',
  ...bundles.flatMap(({prefix, pdfName, pdf, annotationName, translationName, translations}) =>
    [prefix, annotationName, ...(pdf ? [pdfName] : []), ...(translations ? [translationName] : [])]
      .map(name => name.slice('demo/'.length))),
]);
for (const entry of await readdir(demo, {withFileTypes: true})) {
  if (!activePaths.has(entry.name)) {
    await rm(path.join(demo, entry.name), {recursive: true});
  } else if (entry.isDirectory()) {
    const directory = path.join(demo, entry.name);
    for (const child of await readdir(directory)) {
      if (!activePaths.has(`${entry.name}/${child}`)) await rm(path.join(directory, child), {recursive: true});
    }
  }
}
for (const {prefix, pdfName, pdf, annotationName, annotations, translationName, translations} of bundles) {
  await mkdir(path.join(output, prefix), {recursive: true});
  if (pdf) await writeFile(path.join(output, pdfName), pdf);
  await writeFile(path.join(output, annotationName), annotations);
  if (translations) await writeFile(path.join(output, translationName), translations);
}
await writeFile(path.join(output, 'demo/papers.json'), JSON.stringify(library, null, 2) + '\n');
await cp(path.join(root, 'research/phase-4/web/vendor'), path.join(output, 'vendor'), {recursive: true});
const notices = allowed.map(({id,title,authors,year,source_url,license}) =>
  ({id,title,authors,year,source_url,license}));
await writeFile(path.join(output, 'PUBLIC-PAPERS.json'), JSON.stringify({papers: notices}, null, 2) + '\n');
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Staged ${bundles.length} ${publicBuild ? 'public' : 'local'} demo bundles.`);
