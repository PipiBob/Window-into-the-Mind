import {sha256} from '../../research/phase-4/web/sha256.mjs';
import {LABELS, defaultState, selectedIds, blockChoices} from './selection';
import {textStrokes} from './highlightGeometry';
import {clearTextInk, textInkBounds} from './textInk';
import type {Box, Manifest, Mode, Paper, Role, Selection, SemanticRegion, Snapshot} from './types';

export const asset = (path: string) => new URL(import.meta.env.BASE_URL + path.replace(/^\//, ''), document.baseURI).href;
export const initialSnapshot: Snapshot = {library: [], paper: '', data: null, selection: null, ready: false, page: 1, pages: 0, status: 'Opening original PDF…', original: ''};
// PDF.js is the existing vendored runtime. These interfaces describe only its used surface.
interface PageView {div: HTMLDivElement}
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<{getTextContent(): Promise<{items: ({str: string} | object)[]}>}>;
  destroy(): Promise<void>;
}
interface LoadingTask {promise: Promise<PdfDocument>; destroy(): Promise<void>}
interface Viewer {currentPageNumber: number; currentScaleValue: string; setDocument(pdf: PdfDocument | null): void; getPageView(index: number): PageView | undefined; update(): void; cleanup(): void}
interface LinkService {setViewer(viewer: Viewer): void; setDocument(pdf: PdfDocument | null): void}
interface Bus {on(name: string, callback: (event: {pageNumber: number; cssTransform?: boolean; isDetailView?: boolean}) => void): void}
const make = (tag: 'div' | 'span' | 'button', text?: string, cls?: string) => {const node = document.createElement(tag); if(text) node.textContent = text; if(cls) node.className = cls; return node;};
const color = (node: HTMLElement, role: Role) => node.style.setProperty('--facet', `var(--${role})`);
function position(node: HTMLElement, box: Box) {node.style.left = `${box[0]*100}%`; node.style.top = `${box[1]*100}%`; node.style.width = `${(box[2]-box[0])*100}%`; node.style.height = `${(box[3]-box[1])*100}%`;}
async function json<T>(url: string): Promise<T> {const response = await fetch(url); if(!response.ok) throw new Error(`Could not load ${url} (${response.status})`); return response.json();}

async function restorePassages(pdf: PdfDocument, manifest: Manifest) {
  const byPage = new Map<number, Promise<string>>();
  for (const candidate of manifest.candidates) {
    for (const anchor of candidate.anchors) {
      if (!anchor.text_range) continue;
      if (!byPage.has(anchor.page)) {
        byPage.set(anchor.page, pdf.getPage(anchor.page).then(page => page.getTextContent()).then(
          ({items}) => items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/gu, ' ').trim()
        ));
      }
    }
  }
  const text = new Map(await Promise.all([...byPage].map(async ([page, pending]) => [page, await pending] as const)));
  for (const candidate of manifest.candidates) {
    for (const anchor of candidate.anchors) {
      if (!anchor.text_range) continue;
      const [start, end] = anchor.text_range;
      const page = text.get(anchor.page)!;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > page.length) {
        throw new Error('Saved passage location does not match the PDF text.');
      }
      anchor.text = page.slice(start, end);
    }
  }
}

export class Reader {
  snapshot = {...initialSnapshot};
  private viewer!: Viewer;
  private links!: LinkService;
  private getDocument!: (options: object) => LoadingTask;
  private loadingTask: LoadingTask | null = null;
  private generation = 0;
  private disposed = false;
  private lifecycle = new AbortController();
  private zoom = 'auto';
  private lastAnchor = 0;
  private resize?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private sessions = new Map<string, {state: Selection; page: number; anchor: number}>();
  constructor(private container: HTMLDivElement, private viewerElement: HTMLDivElement, private emit: (snapshot: Snapshot) => void) {}
  private publish() {if(!this.disposed) this.emit({...this.snapshot});}
  private notify(status: string) {this.snapshot.status = status; this.publish();}
  private visible() {return selectedIds(this.snapshot.data!, this.snapshot.selection!);}
  private save() {const {data, selection} = this.snapshot; if(data && selection && this.snapshot.ready) this.sessions.set(data.id, {state: selection, page: this.viewer.currentPageNumber, anchor: this.lastAnchor});}
  async start() {
    try {
      const pdfjs = await import(/* @vite-ignore */ asset('vendor/pdfjs/build/pdf.mjs'));
      if(this.disposed) return;
      (globalThis as typeof globalThis & {pdfjsLib: unknown}).pdfjsLib = pdfjs;
      const {EventBus, PDFLinkService, PDFViewer} = await import(/* @vite-ignore */ asset('vendor/pdfjs/web/pdf_viewer.mjs'));
      if(this.disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = asset('vendor/pdfjs/build/pdf.worker.mjs');
      this.getDocument = pdfjs.getDocument;
      const eventBus: Bus = new EventBus();
      this.links = new PDFLinkService({eventBus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer'});
      this.viewer = new PDFViewer({container: this.container, viewer: this.viewerElement, eventBus, linkService: this.links, textLayerMode: 1, annotationMode: 1, removePageBorders: true, abortSignal: this.lifecycle.signal});
      this.links.setViewer(this.viewer);
      eventBus.on('pagesinit', () => {
        if(this.disposed || !this.snapshot.data) return;
        this.viewer.currentScaleValue = this.zoom; this.snapshot.ready = true;
        const saved = this.sessions.get(this.snapshot.data.id);
        this.lastAnchor = saved?.anchor ?? 0;
        this.viewer.currentPageNumber = saved?.page || 1;
        this.snapshot.page = this.viewer.currentPageNumber;
        this.refresh();
      });
      eventBus.on('pagerendered', event => {
        if (!this.snapshot.ready || this.disposed || event.cssTransform || event.isDetailView) return;
        const view = this.viewer.getPageView(event.pageNumber - 1);
        const canvas = view?.div.querySelector<HTMLCanvasElement>('.canvasWrapper > canvas');
        if (canvas) clearTextInk(canvas);
        this.overlay(event.pageNumber, true);
        this.renderMarkers();
      });
      eventBus.on('pagechanging', event => {this.snapshot.page = event.pageNumber; this.save(); this.publish();});
      eventBus.on('scalechanging', () => requestAnimationFrame(() => {if(this.snapshot.ready && !this.disposed) this.renderMarkers();}));
      this.container.addEventListener('scroll', this.updateViewport, {passive: true});
      this.resize = new ResizeObserver(() => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          if (!this.snapshot.ready || this.disposed) return;
          if (this.zoom === 'auto' || this.zoom === 'page-width') this.viewer.currentScaleValue = this.zoom;
          const active = this.snapshot.selection?.selected;
          if (active && this.snapshot.selection?.mode === 'focus') this.scrollToAnchor(active, this.lastAnchor);
          this.viewer.update();
          this.renderMarkers();
        }, 100);
      });
      this.resize.observe(this.container);
      const library = await json<Paper[]>(asset('demo/papers.json'));
      if(this.disposed) return;
      this.snapshot.library = library.map(entry => ({...entry, annotations: asset(entry.annotations), pdf: /^https:\/\//.test(entry.pdf) ? entry.pdf : asset(entry.pdf)}));
      const requested = new URLSearchParams(location.search).get('paper');
      await this.openPaper(library.some(entry => entry.id === requested) ? requested! : library[0].id);
    } catch(error) {this.notify(`Unable to load library: ${error instanceof Error ? error.message : String(error)}`);}
  }
  async openPaper(id: string) {
    if (id === this.snapshot.paper && this.snapshot.ready) return;
    this.save(); const token = ++this.generation;
    Object.assign(this.snapshot, {ready: false, data: null, selection: null, paper: id, original: '', page: 1, pages: 0});
    this.container.scrollTop = 0; this.notify('Opening original PDF…');
    document.getElementById('markers')!.replaceChildren();
    const entry = this.snapshot.library.find(p => p.id === id); if(!entry) return;
    try {
      const oldTask = this.loadingTask; this.loadingTask = null;
      this.viewer.setDocument(null); this.links.setDocument(null); if(oldTask) await oldTask.destroy();
      if(token !== this.generation || this.disposed) return;
      const manifest = await json<Manifest>(entry.annotations);
      if (manifest.id !== entry.id || manifest.provenance?.skill !== entry.skill || (!manifest.route?.length || !manifest.opening?.length)) throw new Error('Guided annotations do not match the selected paper or skill version.');
      const response = await fetch(entry.pdf); if(!response.ok) throw new Error('Original PDF unavailable.');
      const bytes = await response.arrayBuffer();
      if(await sha256(bytes) !== manifest.source.sha256) throw new Error('Source fingerprint does not match saved highlights.');
      if(token !== this.generation || this.disposed) return;
      const task = this.getDocument({data: bytes, cMapUrl: asset('vendor/pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'), wasmUrl: asset('vendor/pdfjs/wasm/'), isEvalSupported: false});
      this.loadingTask = task;
      const pdf = await task.promise;
      if(token === this.generation && !this.disposed) await restorePassages(pdf, manifest);
      if(token !== this.generation || this.disposed) {await pdf.destroy(); return;}
      Object.assign(this.snapshot, {data: manifest, selection: this.sessions.get(id)?.state || defaultState(), original: entry.pdf, pages: pdf.numPages});
      this.links.setDocument(pdf); this.viewer.setDocument(pdf);
      history.replaceState(null, '', `?paper=${encodeURIComponent(id)}`); this.publish();
    } catch(error) {if(token === this.generation && !this.disposed) this.notify(`Unable to open paper: ${error instanceof Error ? error.message : String(error)}`);}
  }
  change(update: (state: Selection, data: Manifest) => void) {if(!this.snapshot.ready) return; update(this.snapshot.selection!, this.snapshot.data!); this.refresh();}
  setMode(mode: Mode) {
    const state = this.snapshot.selection;
    if (mode === 'focus' && state && state.stopIndex >= 0) {
      this.goToStop(state.stopIndex);
    } else {
      this.change(selection => {selection.mode = mode;});
    }
  }
  toggle(role: Role) {this.change(state => {
    if(state.enabled.has(role)) {
      state.enabled.delete(role);
      if(this.snapshot.data!.candidates.find(c => c.id === state.selected)?.role === role) state.selected = null;
    } else state.enabled.add(role);
  });}
  reset() {this.change(state => {state.enabled = defaultState().enabled; state.overrides.clear();});}
  goToStop(index: number, anchorIndex = 0, location?: Box) {
    const {data, selection, ready} = this.snapshot;
    const stop = data?.route[index];
    if (!ready || !stop || !selection) return;
    selection.stopIndex = index;
    selection.mode = 'focus';
    this.jumpTo(stop.id, anchorIndex, location);
  }
  goToRegion(region: SemanticRegion) {
    const {data, selection} = this.snapshot;
    const stop = data?.route.findIndex(item => item.id === region.target) ?? -1;
    if (selection?.mode === 'focus' && stop >= 0) this.goToStop(stop, region.anchor_index, region.box);
    else this.jumpTo(region.target, region.anchor_index, region.box);
  }
  clearStop() {this.change(state => {state.stopIndex = -1; state.selected = null;});}
  setZoom(value: string) {this.zoom = value; if(this.snapshot.ready) this.viewer.currentScaleValue = value;}
  page(number: number) {if(this.snapshot.ready) {this.viewer.currentPageNumber = Math.max(1, Math.min(this.snapshot.pages, number || 1)); this.snapshot.page = this.viewer.currentPageNumber; this.publish();}}
  private refresh() {
    if(!this.snapshot.ready) return;
    this.renderOverlays(); this.renderMarkers(); this.save();
    const count = this.visible().size;
    this.notify(count ? `${count} passage groups highlighted.` : 'Original PDF.');
  }
  jumpTo(id: string, anchorIndex = 0, location?: Box) {
    const {data, selection, ready} = this.snapshot;
    if(!data || !selection || !ready) return;
    const candidate = data.candidates.find(c => c.id === id);
    const anchor = candidate?.anchors[anchorIndex];
    if(!candidate || !anchor) return;
    selection.selected = id;
    this.lastAnchor = anchorIndex;
    this.refresh();
    this.scrollToAnchor(id, anchorIndex, location);
    this.notify(`${candidate.label} · PDF page ${anchor.page}.`);
  }
  private scrollToAnchor(id: string, index: number, location?: Box) {
    const anchor = this.snapshot.data?.candidates.find(candidate => candidate.id === id)?.anchors[index];
    if (!anchor) return;
    const box = location ?? anchor.boxes[0];
    this.viewer.currentPageNumber = anchor.page;
    const page = this.viewer.getPageView(anchor.page - 1);
    if (!page) return;
    this.container.scrollTo({
      top: Math.max(0, page.div.offsetTop + box[1] * page.div.clientHeight - 70),
      left: Math.max(0, page.div.offsetLeft + box[0] * page.div.clientWidth - 30),
      behavior: 'instant',
    });
    this.viewer.update();
  }
  private renderOverlays() {for(let n = 1; n <= this.snapshot.data!.pages.length; n++) this.overlay(n);}
  private overlay(pageNumber: number, retainControls = false) {
    const page = this.viewer.getPageView(pageNumber - 1)?.div, {data, selection} = this.snapshot; if(!page || !data || !selection) return;
    const existing = page.querySelector<HTMLDivElement>('.highlight-layer');
    if (selection.mode === 'original') {
      existing?.remove();
      return;
    }
    const reuse = Boolean(retainControls && existing);
    if (!reuse) existing?.remove();
    const layer = reuse ? existing! : make('div', undefined, 'highlight-layer');
    layer.querySelectorAll('.highlight').forEach(mark => mark.remove());
    layer.dataset.page = String(pageNumber);
    const ids = this.visible();
    const candidates = data.candidates.filter(candidate => ids.has(candidate.id));
    const primary = new Set([...data.opening, ...data.route.map(stop => stop.id)]);
    const canvas = page.querySelector<HTMLCanvasElement>('.canvasWrapper > canvas');
    const align = canvas?.dataset.renderedInk === 'true' || (retainControls && canvas)
      ? (box: Box) => textInkBounds(canvas, box) : undefined;
    if (retainControls && canvas) canvas.dataset.renderedInk = 'true';
    for (const stroke of textStrokes(candidates, pageNumber, primary, selection.selected, align)) {
      const mark = make('span', undefined, `highlight stroke${stroke.focused ? ' focused' : ''}`);
      mark.dataset.candidate = stroke.id;
      color(mark, stroke.role);
      position(mark, stroke.box);
      layer.append(mark);
    }
    for (const candidate of candidates) {
      for (const anchor of candidate.anchors.filter(anchor => anchor.region && anchor.page === pageNumber)) {
        for (const box of anchor.boxes) {
          const mark = make('span', undefined, `highlight region${selection.selected === candidate.id ? ' focused' : ''}`);
          mark.dataset.candidate = candidate.id;
          color(mark, candidate.role);
          position(mark, box);
          layer.append(mark);
        }
      }
    }
    if (reuse) return;
    for (const region of data.semantic_regions ?? []) {
      if (region.page !== pageNumber) continue;
      const outline = make('span', undefined, 'semantic-region');
      outline.dataset.region = region.id;
      outline.setAttribute('aria-hidden', 'true');
      position(outline, region.box);
      layer.prepend(outline);
    }
    for(const block of selection.mode === 'explore' ? data.blocks.filter(b => b.page === pageNumber) : []) {
      const group = make('div', undefined, 'paragraph-control'); group.dataset.block = block.id; group.style.left = `${Math.max(.07, block.box[0] - .015)*100}%`; group.style.top = `${block.box[1]*100}%`;
      const choices = blockChoices(block, data, selection);
      if (!choices.add && !choices.remove) continue;
      for(const [key, label, symbol] of [['remove', 'Fewer', '−'], ['add', 'More', '+']] as const) {
        const button = document.createElement('button'); button.textContent = symbol; button.setAttribute('aria-label', `${label} highlights in paragraph ${block.id}`); button.title = choices[key] ? `${label} highlights in this paragraph` : `No ${key === 'add' ? 'more saved' : 'visible'} candidates in this paragraph`; button.disabled = !choices[key];
        button.onclick = () => {const choice = blockChoices(block, data, selection)[key]; if(!choice) return; selection.overrides.set(choice.id, key === 'add'); this.refresh(); page.querySelector<HTMLButtonElement>(`[data-block="${CSS.escape(block.id)}"] button:nth-child(${key === 'remove' ? 1 : 2})`)?.focus(); this.notify(`${key === 'add' ? 'Added' : 'Removed'}: ${choice.label}. Changes apply to this saved passage group.`);}; group.append(button);
      } layer.append(group);
    } page.append(layer);
  }
  private renderMarkers() {
    const markers = document.getElementById('markers')!; markers.replaceChildren(); const {data, selection} = this.snapshot; if(!data || !selection || selection.mode === 'original') return;
    const ids = this.visible();
    for(const candidate of data.candidates) {if(!ids.has(candidate.id)) continue;
      for(const [index, anchor] of candidate.anchors.entries()) {const page = this.viewer.getPageView(anchor.page - 1); if(!page) continue;
        const mark = make('button', undefined, 'marker'); color(mark, candidate.role); mark.style.top = `${100*(page.div.offsetTop + anchor.boxes[0][1]*page.div.clientHeight)/this.container.scrollHeight}%`; mark.title = `${LABELS[candidate.role]} · page ${anchor.page}: ${candidate.label}`; mark.setAttribute('aria-label', mark.title); mark.onclick = () => this.jumpTo(candidate.id, index); markers.append(mark);
      }
    } this.updateViewport();
  }
  private updateViewport = () => {const marker = document.getElementById('viewport-marker'); if(!marker) return; marker.style.top = `${100*this.container.scrollTop/this.container.scrollHeight}%`; marker.style.height = `${Math.min(100, 100*this.container.clientHeight/this.container.scrollHeight)}%`;};
  dispose() {this.disposed = true; this.lifecycle.abort(); this.generation++; this.resize?.disconnect(); clearTimeout(this.resizeTimer); this.container.removeEventListener('scroll', this.updateViewport); this.viewer?.setDocument(null); this.links?.setDocument(null); void this.loadingTask?.destroy();}
}
