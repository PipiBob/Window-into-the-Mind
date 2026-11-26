// Run with Playwright and an optional Chromium executable against a local Vite server.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.READER_URL || 'http://127.0.0.1:5173/';
const output = process.env.TEST_OUTPUT;
const pagesOnly = process.env.PAGES_ONLY === '1';

async function text(locator, search) {
  await locator.filter({hasText: search}).waitFor({state: 'visible'});
}
async function pageNumber(page, number) {
  await page.waitForFunction(expected => Number(document.querySelector('#page-number').value) === expected, number);
}

async function verifyActiveStop(page, index, stop) {
  await page.locator('.active-stop').getByRole('heading', {name: stop.title, exact: true}).waitFor();
  assert.equal(await page.locator('#reading-progress').getAttribute('value'), String(index + 1));
}

async function verifyZoom(page, number, id, prefix, width = 595.276) {
  const zoom = page.getByRole('combobox', {name: 'Zoom'});
  const target = page.locator(`.page[data-page-number="${number}"]`);
  let baseline;
  for (const scale of ['0.75', '1', '1.5', '2', 'auto']) {
    await zoom.selectOption(scale);
    await page.locator('.active-stop > .source-quote .source-fragment').first().click();
    await target.locator('.canvasWrapper > canvas[data-rendered-ink]').first().waitFor();
    if (scale !== 'auto') {
      await page.waitForFunction(({number, scale, width}) => {
        const target = document.querySelector(`.page[data-page-number="${number}"]`);
        return Math.abs(target.clientWidth / width - Number(scale) * 4 / 3) < .01;
      }, {number, scale, width});
    }
    const positions = await target.evaluate((node, id) => {
      const bounds = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll(`.stroke[data-candidate="${id}"]`), mark => {
        const r = mark.getBoundingClientRect();
        return [(r.x - bounds.x) / bounds.width, (r.y - bounds.y) / bounds.height,
          r.width / bounds.width, r.height / bounds.height];
      });
    }, id);
    assert(positions.length > 1, `Expected multiple marked lines for ${id}`);
    baseline ??= positions;
    assert.equal(positions.length, baseline.length);
    for (const [index, rect] of positions.entries()) {
      // Ink bounds are measured on the rendered bitmap and quantized to its pixels.
      assert(rect.every((value, axis) => Math.abs(value - baseline[index][axis]) < (axis % 2 ? .0045 : .0005)),
        `Misaligned ${id} stroke at zoom ${scale}`);
    }
    if (prefix === 'ethereum') await verifyInkAlignment(target, id);
    if (output && (scale === '1.5' || scale === 'auto')) {
      await page.screenshot({path: `${output}/${prefix}-${scale}.png`});
    }
  }
}

async function verifyInkAlignment(target, id) {
  const misaligned = await target.evaluate((node, id) => {
    const canvas = node.querySelector('.canvasWrapper > canvas[data-rendered-ink]');
    if (!canvas) return ['PDF canvas has not finished rendering'];
    const ctx = canvas.getContext('2d');
    const page = node.getBoundingClientRect();
    return Array.from(node.querySelectorAll(`.stroke[data-candidate="${id}"]`)).flatMap(mark => {
      const r = mark.getBoundingClientRect();
      const left = Math.max(0, Math.floor((r.left - page.left) / page.width * canvas.width));
      const right = Math.min(canvas.width, Math.ceil((r.right - page.left) / page.width * canvas.width));
      const top = Math.round((r.top - page.top) / page.height * canvas.height);
      const bottom = Math.round((r.bottom - page.top) / page.height * canvas.height);
      const width = right - left;
      const ink = y => {
        const {data} = ctx.getImageData(left, y, width, 1);
        return data.some((v, i) => i % 4 === 0 && v < 180 && data[i + 1] < 180 && data[i + 2] < 180);
      };
      const edgeAllowance = Math.ceil((bottom - top) * .17);
      const topMatches = Array.from({length: edgeAllowance + 1}, (_, i) => top + i).some(ink);
      const bottomMatches = Array.from({length: edgeAllowance + 1}, (_, i) => bottom - 1 - i).some(ink);
      return topMatches && bottomMatches ? [] : [[top, bottom]];
    });
  }, id);
  assert.deepEqual(misaligned, []);
}

async function verifyNoOverlap(page) {
  const overlap = await page.locator('.highlight-layer').evaluateAll(layers => layers.some(layer => {
    const rects = Array.from(layer.querySelectorAll('.stroke'), node => node.getBoundingClientRect());
    return rects.some((a, i) => rects.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .05
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .05));
  }));
  assert.equal(overlap, false, 'Rendered text strokes must not stack');
}

async function verifyOpening(page, name, finding = 'opening-discovery') {
  await page.locator('.route-stop').first().waitFor();
  await pageNumber(page, 1);
  const first = page.locator('.page[data-page-number="1"]');
  await first.locator('canvas').waitFor();
  await first.locator(`.stroke[data-candidate="${finding}"]`).first().waitFor();
  const inViewport = await first.locator(`.stroke[data-candidate="${finding}"]`).first().evaluate(mark => {
    const rect = mark.getBoundingClientRect();
    const viewport = document.querySelector('#pdf-container').getBoundingClientRect();
    return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
  });
  assert(inViewport, `${name} finding should be visible when the paper opens`);
  if (output) {
    fs.mkdirSync(output, {recursive: true});
    await page.screenshot({path: `${output}/${name}-opening.png`});
  }
}

async function verifyEvidence(page, stop) {
  for (const visual of stop.visual ?? []) {
    const figure = page.locator('.active-stop .finding-evidence').filter({hasText: visual.label});
    const crop = figure.getByRole('img', {name: visual.label});
    await crop.waitFor();
    await page.waitForFunction(label => [...document.images].some(
      image => image.alt === label && image.naturalWidth > 300), visual.label);
    assert.match(await figure.getByRole('link', {name: 'Enlarge ↗'}).getAttribute('href'), /^blob:/);
    await figure.getByRole('button', {name: `View in PDF · p. ${visual.page}`}).click();
    await page.waitForFunction(({page, box}) => {
      const sheet = document.querySelector(`.page[data-page-number="${page}"]`).getBoundingClientRect();
      const viewport = document.querySelector('#pdf-container').getBoundingClientRect();
      const top = sheet.top + box[1] * sheet.height;
      return top >= viewport.top && top < viewport.bottom;
    }, visual);
  }
}

async function verifyEthereum(page, requests) {
  const manifest = pagesOnly
    ? require('../../research/finding-evidence-refinement/ethereum-public-references.json')
    : require('../../research/finding-evidence-refinement/ethereum-final-annotations.json');
  const candidates = new Map(manifest.candidates.map(candidate => [candidate.id, candidate]));
  await verifyOpening(page, 'ethereum', manifest.opening.find(id => candidates.get(id).role === 'result'));
  assert.equal(await page.locator('.semantic-region, .semantic-topics').count(), 0);
  const guidedIds = [...manifest.opening, ...manifest.route.map(stop => stop.id)];
  const roles = new Set(guidedIds.map(id => candidates.get(id).role));
  const legend = await page.getByLabel('Highlight colors').textContent();
  assert.equal(legend.includes('Contribution'), roles.has('novelty'));
  assert.equal(legend.includes('Limitation'), roles.has('caveat'));
  const first = page.locator('.route-stop').first();
  await first.click();
  await verifyActiveStop(page, 0, manifest.route[0]);
  await pageNumber(page, candidates.get(manifest.route[0].id).anchors[0].page);
  const currentPage = await page.getByLabel('Page number').inputValue();
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.locator('.active-stop').waitFor({state: 'hidden'});
  await first.waitFor();
  assert.equal(await page.getByLabel('Page number').inputValue(), currentPage);

  for (const [index, stop] of manifest.route.entries()) {
    const candidate = candidates.get(stop.id);
    if (index === 0) await first.click();
    else await page.getByRole('button', {name: /^Next stop/}).click();
    await verifyActiveStop(page, index, stop);
    const quote = candidate.anchors[0].text;
    if (quote) await text(page.locator('.active-stop > .source-quote'), quote.replace(/\s+/g, ' '));
    else assert((await page.locator('.active-stop > .source-quote .source-fragment span').first().textContent()).trim());
    // PDF.js can report the next page when it occupies more of the viewport.
    // Verify the selected anchor itself arrived inside the reading surface.
    await page.waitForFunction(({page, boxes}) => {
      const viewport = document.querySelector('#pdf-container').getBoundingClientRect();
      const sheet = document.querySelector(`.page[data-page-number="${page}"]`).getBoundingClientRect();
      return sheet.top + sheet.height * boxes[0][1] >= viewport.top &&
        sheet.top + sheet.height * boxes[0][3] <= viewport.bottom;
    }, candidate.anchors[0]);
    assert(await page.locator(`.stroke[data-candidate="${candidate.id}"]`).count());
    await verifyEvidence(page, stop);
  }

  const zoomStop = manifest.route.findLastIndex(stop => {
    const candidate = candidates.get(stop.id);
    return candidate.role === 'result' && candidate.anchors[0].boxes.length > 1;
  });
  assert(zoomStop >= 0, 'An essential finding should have visible source lines');
  const zoomCandidate = candidates.get(manifest.route[zoomStop].id);
  const number = zoomCandidate.anchors[0].page;
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.locator('.route-stop').nth(zoomStop).click();
  await verifyActiveStop(page, zoomStop, manifest.route[zoomStop]);
  await verifyZoom(page, number, zoomCandidate.id, 'ethereum', 612);
  await page.setViewportSize({width: 390, height: 844});
  const mobilePage = page.locator(`.page[data-page-number="${number}"]`);
  await page.waitForFunction(number => {
    const section = document.querySelector('#pdf-container');
    const paper = document.querySelector(`.page[data-page-number="${number}"]`);
    return paper?.querySelector('canvas[data-rendered-ink]') && paper.clientWidth <= section.clientWidth + 15;
  }, number);
  await verifyInkAlignment(mobilePage, zoomCandidate.id);
  if (output) await page.screenshot({path: `${output}/ethereum-mobile.png`});

  await page.setViewportSize({width: 1320, height: 900});
  await page.getByRole('button', {name: 'Explore', exact: true}).click();
  assert.equal(await page.locator('.explore-item').count(), manifest.candidates.length);
  assert.equal(await page.locator('#markers .marker').count(),
    manifest.candidates.reduce((count, candidate) => count + candidate.anchors.length, 0));
  await verifyNoOverlap(page);
  await page.getByRole('button', {name: 'PDF only', exact: true}).click();
  assert.equal(await page.locator('.highlight').count(), 0);
  await page.getByRole('button', {name: 'Show reading panel'}).click();
  assert.equal(await page.locator('.semantic-region, .semantic-topics, .highlight.region').count(), 0);
  await text(page.locator('h1'), 'Explore highlights');
  const guide = `academic-skimming-v7${pagesOnly ? '-reference' : ''}.json`;
  assert(requests.some(url => url.endsWith(`/ethereum/${guide}`)));
  if (pagesOnly) {
    const source = 'https://arxiv.org/pdf/2502.05054v1';
    assert(requests.includes(source));
    assert.equal(await page.getByRole('link', {name: /Original PDF/}).getAttribute('href'), source);
    assert(!requests.some(url => url.endsWith('/ethereum/source.pdf')));
  }
  assert(!requests.some(url => /\/ethereum\/(guided-annotations|academic-skimming-v[1-4])\.json$/.test(url)));
}

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME});
  try {
    const page = await browser.newPage({viewport: {width: 1320, height: 900}});
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    if (process.env.ETHEREUM_ONLY === '1') {
      await page.goto(new URL('?paper=ethereum', base).href);
      await verifyEthereum(page, requests);
      assert(!requests.some(url => /\/demo\/(similarity|anger)\//.test(url)));
      assert.deepEqual(errors, []);
      console.log('Ethereum only: current bundle, all guided stops, accordion navigation, five zoom levels, mobile alignment, and non-overlapping strokes passed.');
      return;
    }
    const similarityOnly = process.env.SIMILARITY_ONLY === '1';
    for (const id of similarityOnly ? ['similarity'] : process.env.NEW_STUDY_ONLY === '1' ? ['anger'] : ['anger', 'similarity']) {
      await page.goto(new URL(`?paper=${id}`, base).href);
      const manifest = id === 'similarity'
        ? require('../../research/finding-evidence-refinement/similarity-annotations.json')
        : require('../../research/finding-evidence-refinement/anger-final-annotations.json');
      const candidates = new Map(manifest.candidates.map(candidate => [candidate.id, candidate]));
      const finding = manifest.opening.find(id => candidates.get(id).role === 'result');
      await verifyOpening(page, id, finding);
      for (const [index, stop] of manifest.route.entries()) {
        if (index === 0) await page.locator('.route-stop').first().click();
        else await page.getByRole('button', {name: /^Next stop/}).click();
        await verifyActiveStop(page, index, stop);
        const quote = candidates.get(stop.id).anchors[0].text.replace(/\s+/g, ' ');
        await text(page.locator('.active-stop > .source-quote'), quote);
        await page.locator(`.stroke[data-candidate="${stop.id}"]`).first().waitFor();
        await verifyEvidence(page, stop);
      }
      await page.getByRole('button', {name: 'Explore', exact: true}).click();
      assert.equal(await page.locator('.explore-item').count(), manifest.candidates.length);
      await verifyNoOverlap(page);
      await page.getByRole('button', {name: 'PDF only', exact: true}).click();
      assert.equal(await page.locator('.highlight').count(), 0);
      assert(requests.some(url => url.endsWith(`/${id}/${manifest.provenance.skill.replace("/", "-v")}.json`)));
      assert(!requests.some(url => url.endsWith(`/${id}/academic-skimming-v3.json`)));
    }
    if (!similarityOnly) {
      await page.goto(new URL('?paper=ethereum', base).href);
      await verifyEthereum(page, requests);
      assert.deepEqual(await page.locator('#paper option').evaluateAll(options => options.map(option => option.value).sort()),
        ['anger', 'ethereum', 'similarity']);
    }
    const subpath = new URL(base).pathname;
    assert(requests.filter(url => /\/(demo|vendor)\//.test(url)).every(url => new URL(url).pathname.startsWith(subpath)));
    assert.deepEqual(errors, []);
    console.log(`Browser smoke passed for ${similarityOnly ? 'Similarity' : pagesOnly ? 'all three Pages papers' : 'all three study papers'}.`);
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
