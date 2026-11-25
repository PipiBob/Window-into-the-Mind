// Run with Playwright and an optional Chromium executable against a local Vite server.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.READER_URL || 'http://127.0.0.1:5173/';
const output = process.env.TEST_OUTPUT;

async function text(locator, search) {
  await locator.filter({hasText: search}).waitFor({state: 'visible'});
}
async function pageNumber(page, number) {
  await page.waitForFunction(expected => Number(document.querySelector('#page-number').value) === expected, number);
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
      assert(rect.every((value, axis) => Math.abs(value - baseline[index][axis]) < (axis % 2 ? .003 : .0005)),
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
      const topMatches = ink(top) || ink(top + 1);
      const bottomMatches = ink(bottom - 1) || ink(Math.max(top, bottom - 2));
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
  await page.getByRole('button', {name: 'Start skimming'}).waitFor();
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

async function verifyEthereum(page, requests) {
  await verifyOpening(page, 'ethereum', 'pattern');
  await page.locator('.semantic-region[data-region="study-overview"]').waitFor();
  await text(page.getByRole('navigation', {name: 'Topics on this page'}), 'Study and headline finding');
  assert(!(await page.getByLabel('Highlight colors').textContent()).includes('Contribution'));
  await page.locator('.intro').getByRole('button', {name: /Reactions differed by type of event/}).click();
  await text(page.locator('.intro .related'), 'RQ4');
  await page.getByRole('button', {name: 'Start skimming'}).click();
  for (const question of ['RQ 1:', 'RQ 2.', 'RQ 3.', 'RQ 4.']) {
    await text(page.locator('.active-stop > .source-quote'), question);
  }
  const next = page.getByRole('button', {name: 'Next stop'});
  for (const [id, answer] of [['study-design', 'at least two'], ['window', '90 days'], ['commits', 'Answer to RQ2'],
    ['issues', 'issue resolution times change'], ['collaboration', 'March 2020 market crash']]) {
    await next.click();
    await text(page.locator('.active-stop > .source-quote'), answer);
    assert(await page.locator(`.stroke[data-candidate="${id}"]`).count());
    if (id === 'study-design') {
      await page.getByRole('button', {name: /View Why these repositories and events, page 4/}).click();
      await pageNumber(page, 4);
      await page.locator('.semantic-region[data-region="event-selection"]').waitFor();
      await page.getByRole('button', {name: 'Which events count as major'}).click();
      await pageNumber(page, 4);
      await text(page.locator('#active-title'), 'Why these repositories and events?');
      assert(await page.locator('.semantic-region[data-region="event-selection"]').evaluate(node =>
        node.getBoundingClientRect().top >= document.querySelector('#pdf-container').getBoundingClientRect().top));
      if (output) await page.screenshot({path: `${output}/ethereum-region.png`});
    }
    if (id === 'window') await text(page.locator('.active-stop > .source-quote'), 'tends to decrease after four months');
    if (id === 'commits') await text(page.locator('.active-stop > .source-quote'), 'pre-event activity concentration');
  }
  await text(page.locator('.active-stop > .reading-note'), 'closed triangles');
  await verifyZoom(page, 10, 'collaboration', 'ethereum', 612);
  await page.getByRole('button', {name: /View Figure 9/}).click();
  await page.locator('.page[data-page-number="10"] canvas').waitFor();
  await page.locator('.region.focused[data-candidate="network-figure"]').waitFor();
  if (output) await page.screenshot({path: `${output}/ethereum-figure.png`});
  await page.getByRole('button', {name: /Back to this stop/}).click();
  await text(page.locator('#active-title'), 'When did collaboration');
  await page.setViewportSize({width: 390, height: 844});
  const mobilePage = page.locator('.page[data-page-number="10"]');
  await page.waitForFunction(() => {
    const section = document.querySelector('#pdf-container');
    const paper = document.querySelector('.page[data-page-number="10"]');
    return paper?.querySelector('canvas[data-rendered-ink]') && paper.clientWidth <= section.clientWidth + 15;
  });
  await verifyInkAlignment(mobilePage, 'collaboration');
  if (output) await page.screenshot({path: `${output}/ethereum-mobile.png`});
  await page.setViewportSize({width: 1320, height: 900});
  await next.click();
  await text(page.locator('.active-stop .context'), 'overlapping post-event');
  const focusedCount = await page.locator('.highlight').count();
  await page.getByRole('button', {name: 'Explore', exact: true}).click();
  assert(await page.locator('.highlight').count() > focusedCount);
  await verifyNoOverlap(page);
  await page.getByRole('button', {name: 'PDF only', exact: true}).click();
  assert.equal(await page.locator('.highlight').count(), 0);
  assert.equal(await page.locator('.semantic-region').count(), 0);
  await page.getByRole('button', {name: 'Show reading panel'}).click();
  assert.equal(await page.locator('.semantic-region').count(), 6);
  await text(page.locator('h1'), 'Explore highlights');
  assert(requests.some(url => url.endsWith('/ethereum/academic-skimming-v3.json')));
  assert(!requests.some(url => /\/ethereum\/(guided-annotations|academic-skimming-v[12])\.json$/.test(url)));
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
      assert(!requests.some(url => /\/demo\/(programming|anger)\//.test(url)));
      assert.deepEqual(errors, []);
      console.log('Ethereum only: current bundle, all four Q&A stops, explanations, figure navigation, ink alignment at five zoom settings and on mobile, density modes and non-overlapping strokes passed.');
      return;
    }
    for (const fixture of [
      {id: 'programming', caption: 'The experiment and its main findings', title: 'Do form and meaning produce distinct brain responses?', result: 'Separate signals for form and meaning', figure: /View Figure 3/},
      {id: 'anger', caption: 'The comparison and headline finding', title: 'Can discarding the written account reduce anger?', result: 'What changed when the note was thrown away?', figure: /View Figure 1/},
    ]) {
      await page.goto(new URL(`?paper=${fixture.id}`, base).href);
      await verifyOpening(page, fixture.id);
      await page.getByRole('button', {name: fixture.caption, exact: true}).waitFor();
      await page.locator('.page[data-page-number="1"] .semantic-region').waitFor();
      assert(!((await page.getByLabel('Highlight colors').textContent()).includes('Contribution')));
      await page.getByRole('button', {name: 'Start skimming'}).click();
      await text(page.locator('#active-title'), fixture.title);
      const next = page.getByRole('button', {name: 'Next stop'});
      await next.click();
      if (fixture.id === 'anger') await next.click();
      await text(page.locator('#active-title'), fixture.result);
      await page.getByRole('button', {name: fixture.figure}).click();
      await page.locator('.region.focused').waitFor();
      await page.getByRole('button', {name: /Back to this stop/}).click();
      await page.getByRole('button', {name: 'Explore', exact: true}).click();
      await verifyNoOverlap(page);
      await page.getByRole('button', {name: 'PDF only', exact: true}).click();
      assert.equal(await page.locator('.highlight, .semantic-region').count(), 0);
      assert(requests.some(url => url.endsWith(`/${fixture.id}/academic-skimming-v3.json`)));
    }
    if (process.env.PAGES_ONLY !== '1') {
      await page.goto(new URL('?paper=ethereum', base).href);
      await verifyEthereum(page, requests);
    } else {
      assert.equal(await page.locator('#paper option').count(), 2);
      assert(!requests.some(url => /\/demo\/ethereum\//.test(url)));
    }
    const subpath = new URL(base).pathname;
    assert(requests.filter(url => /\/(demo|vendor)\//.test(url)).every(url => new URL(url).pathname.startsWith(subpath)));
    assert.deepEqual(errors, []);
    console.log(`Browser smoke passed for ${process.env.PAGES_ONLY === '1' ? 'the two cleared Pages papers' : 'all three study papers'}.`);
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
