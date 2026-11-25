import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {ROLES, LABELS, selectedIds} from './selection';
import {initialSnapshot, Reader} from './reader';
import {overlappingRoles} from './highlightGeometry';
import type {Anchor, Candidate, Mode, Role} from './types';

const facet = (role: Role) => ({'--facet': `var(--${role})`} as CSSProperties);
const roles: Record<Role, string> = {
  objective: 'What is being asked', novelty: 'What the paper adds', method: 'How it was studied',
  result: 'What the study found', caveat: 'What qualifies the result',
};

function Passage({candidate, secondary, jump}: {candidate: Candidate; secondary: Role[]; jump: (index: number) => void}) {
  return <div className="source-quote" style={facet(candidate.role)}>
    <span className="source-role"><i className="swatch" />{LABELS[candidate.role]}{secondary.length > 0 && <small>Also {secondary.map(role => LABELS[role]).join(", ")}</small>}</span>
    {candidate.anchors.map((anchor: Anchor, index) => <button className="source-fragment" key={index}
      aria-label={`View ${anchor.region ?? candidate.label}, page ${anchor.page}, selection ${index + 1}`}
      onClick={() => jump(index)}>
      <span>{anchor.region ?? anchor.text.replace(/\s+/g, ' ')}</span>
      <small>p. {anchor.page} ↗</small>
    </button>)}
  </div>;
}

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [sidebar, setSidebar] = useState(true);
  const previousMode = useRef<Exclude<Mode, 'original'>>('focus');
  const [zoom, setZoom] = useState('auto');
  const [pageInput, setPageInput] = useState('1');

  useEffect(() => {
    let lastPage = 1;
    const instance = new Reader(container.current!, viewer.current!, next => {
      if (next.page !== lastPage) {
        lastPage = next.page;
        setPageInput(String(next.page));
      }
      setSnapshot(next);
    });
    reader.current = instance;
    void instance.start();
    return () => { instance.dispose(); reader.current = null; };
  }, []);

  const {data, selection, ready} = snapshot;
  const mode = selection?.mode ?? 'focus';
  const paper = snapshot.library.find(entry => entry.id === snapshot.paper);
  const stopIndex = selection?.stopIndex ?? -1;
  useEffect(() => {panel.current?.scrollTo(0, 0);}, [snapshot.paper, mode, stopIndex]);
  const stop = data?.route[stopIndex];
  const candidates = new Map(data?.candidates.map(candidate => [candidate.id, candidate]));
  const primary = stop ? candidates.get(stop.id) : undefined;
  const companions = stop?.context.map(id => candidates.get(id)!) ?? [];
  const evidence = companions.filter(candidate => candidate.anchors.some(anchor => anchor.region));
  const context = companions.filter(candidate => !evidence.includes(candidate));
  const selected = selection?.selected ? candidates.get(selection.selected) : undefined;
  const detour = stop && selected && selected !== primary ? selected : undefined;
  const detourIsCompanion = Boolean(detour && stop?.context.includes(detour.id));
  const shown = data && selection ? selectedIds(data, selection) : new Set<string>();
  const availableRoles = ROLES.filter(role => data?.candidates.some(candidate => candidate.role === role));
  const legendRoles = availableRoles.filter(role => data?.candidates.some(candidate => candidate.role === role && shown.has(candidate.id)));
  const pageRegions = data?.semantic_regions?.filter(region => region.page === snapshot.page) ?? [];
  const explore = (data?.candidates ?? []).filter(candidate => shown.has(candidate.id))
    .sort((a, b) => a.anchors[0].page - b.anchors[0].page || a.anchors[0].boxes[0][1] - b.anchors[0].boxes[0][1]);
  const go = (index: number) => reader.current?.goToStop(index);
  const jump = (id: string, index = 0) => {
    reader.current?.jumpTo(id, index);
    if (mode === 'focus' && id !== primary?.id) panel.current?.scrollTo(0, 0);
  };
  const navigate = (number: number) => {
    reader.current?.page(number);
    setPageInput(String(reader.current?.snapshot.page ?? 1));
  };
  const setMode = (nextMode: Exclude<Mode, 'original'>) => reader.current?.setMode(nextMode);
  const showPanel = () => {
    reader.current?.setMode(previousMode.current);
    setSidebar(true);
  };
  const togglePanel = () => {
    if (!sidebar) {
      showPanel();
      return;
    }
    if (mode !== 'original') previousMode.current = mode;
    reader.current?.setMode('original');
    setSidebar(false);
  };
  const showPassage = (candidate: Candidate) => <Passage key={candidate.id} candidate={candidate} secondary={overlappingRoles(candidate, data?.candidates ?? [])} jump={index => jump(candidate.id, index)} />;
  const related = (candidate: Candidate, exclude: string[] = []) => {
    const links = candidate.related_to.filter(id => candidates.has(id) && !exclude.includes(id));
    return links.length > 0 && <div className="related"><h3>Explore related passages</h3>
      {links.map(id => <button key={id} onClick={() => jump(id)}>{candidates.get(id)!.label} <span aria-hidden="true">↗</span></button>)}
    </div>;
  };

  const tools = (<div className="pdf-toolbar">
          <nav aria-label="PDF navigation">
            <button aria-label="Previous page" disabled={!ready || snapshot.page === 1} onClick={() => navigate(snapshot.page - 1)}>‹</button>
            <label>Page <input id="page-number" type="number" aria-label="Page number" min="1" max={snapshot.pages || 1}
              disabled={!ready} value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={() => navigate(Number(pageInput))}
              onKeyDown={e => {if (e.key === 'Enter') navigate(Number(pageInput));}}/></label>
            <span className="page-total">{snapshot.pages ? `/ ${snapshot.pages}` : ''}</span>
            <button aria-label="Next page" disabled={!ready || snapshot.page === snapshot.pages} onClick={() => navigate(snapshot.page + 1)}>›</button>
            <select id="zoom" aria-label="Zoom" value={zoom} onChange={e => {setZoom(e.target.value); reader.current?.setZoom(e.target.value);}}>
              <option value="auto">Auto</option><option value="page-width">Fit width</option><option value="0.75">75%</option>
              <option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option>
            </select>
          </nav>
          {snapshot.original && <a id="original" href={snapshot.original} target="_blank" rel="noopener">Original PDF ↗</a>}
        </div>);

  return <div className="app">
    <header className="masthead">
      <label className="paper-picker"><select id="paper" aria-label="Choose paper" title={paper?.title} value={snapshot.paper}
        disabled={!snapshot.library.length} onChange={e => {if (!sidebar) showPanel(); void reader.current?.openPaper(e.target.value);}}>
        {snapshot.library.length ? snapshot.library.map(p => <option key={p.id} value={p.id}>{p.shortTitle}</option>) : <option value="">Loading papers…</option>}
      </select></label>
      {!sidebar && tools}
      <button className="panel-toggle" aria-controls="sidebar" aria-expanded={sidebar} disabled={!ready} onClick={togglePanel}>
        {sidebar ? 'PDF only' : 'Show reading panel'}
      </button>
    </header>
    <main className="workspace">
      <section className="reading-surface" aria-label={paper?.title ?? 'Original PDF'}>
        <div className="pdf-stage">
          <div id="pdf-container" tabIndex={0} ref={container}><div id="viewer" className="pdfViewer" ref={viewer}/></div>
          <div id="distribution" aria-label="Highlighted locations" hidden={mode === 'original'}><div id="viewport-marker"/><div id="markers"/></div>
        </div>
      </section>
      <aside id="sidebar" aria-label="Paper reading panel" hidden={!sidebar}>
        <div className="mode-tabs" role="group" aria-label="Reading mode">
          {([['focus', 'Guided skim'], ['explore', 'Explore']] as const).map(([id, label]) =>
            <button key={id} disabled={!ready} onClick={() => setMode(id)} aria-pressed={mode === id}>{label}</button>)}
        </div>
        {tools}
        {ready && legendRoles.length > 0 && <div className="legend" aria-label="Highlight colors">
          {legendRoles.map(role => <span key={role} style={facet(role)} title={roles[role]}><i className="swatch"/>{LABELS[role]}</span>)}
        </div>}
        {ready && mode !== 'original' && pageRegions.length > 0 && <nav className="semantic-topics" aria-label="Topics on this page">
          {pageRegions.map(region => <button key={region.id} data-topic={region.id}
            onClick={() => reader.current?.goToRegion(region)}>{region.label}</button>)}
        </nav>}
        <div className="panel-content" ref={panel} key={snapshot.paper}>
          {snapshot.status.startsWith('Unable') ? <p className="message">{snapshot.status}</p> : !ready || !data ? <p className="message">Opening the original paper…</p> :
            mode === 'focus' ? <>
              {!stop ? <div className="intro">
                <h1>{paper?.shortTitle}</h1>
                <p>Follow the study’s question, methods and findings through selected passages in the original paper.</p>
                <button className="primary" onClick={() => go(0)}>Start skimming <span aria-hidden="true">→</span></button>
                <div className="context">
                  <h2>On the first page</h2>
                  {data.opening.map(id => {
                    const candidate = candidates.get(id)!;
                    return <div key={id} className="explore-item">
                      <button className="explore-title" style={facet(candidate.role)} aria-expanded={selected?.id === id}
                        onClick={() => jump(id)}><i className="swatch"/><span>{candidate.label}</span><small>p. 1</small></button>
                      {selected?.id === id && <>{showPassage(candidate)}{related(candidate)}</>}
                    </div>;
                  })}
                  {data.opening_note && <p className="reading-note">{data.opening_note}</p>}
                </div>
                {selected && !data.opening.includes(selected.id) && <div className="standalone-source">
                  {showPassage(selected)}{related(selected)}
                </div>}
              </div> : <section className="active-stop" aria-labelledby="active-title">
                <div className="stop-progress" aria-live="polite">Stop {stopIndex + 1} of {data.route.length}</div>
                <h1 id="active-title">{stop.title}</h1>
                {detour && <div className="detour">
                  <button className="quiet" onClick={() => go(stopIndex)}>← Back to this stop</button>
                  {!detourIsCompanion && <><h2>{detour.label}</h2>{showPassage(detour)}</>}
                </div>}
                {stop.note && <p className="reading-note">{stop.note}</p>}
                {primary && showPassage(primary)}
                {evidence.length > 0 && <div className="context">
                  <h2>See the evidence</h2>
                  {evidence.map(showPassage)}
                </div>}
                {context.length > 0 && <div className="context">
                  <h2>Read alongside</h2>
                  {context.map(showPassage)}
                </div>}
                {primary?.purpose && <details className="why"><summary>Why this passage?</summary><p>{primary.purpose}</p></details>}
                {primary && related(primary, stop.context)}
              </section>}
              <details className="route" open={stopIndex < 0 || undefined}>
                <summary>Reading path</summary>
                <ol>{data.route.map((item, index) => {
                  const candidate = candidates.get(item.id)!;
                  return <li key={item.id}>
                    <button style={facet(candidate.role)} aria-current={index === stopIndex ? 'step' : undefined} onClick={() => go(index)}>
                      <i className="swatch"/><span>{item.title}</span><small>p. {candidate.anchors[0].page}</small>
                    </button>
                  </li>;
                })}</ol>
              </details>
            </> : mode === 'explore' ? <>
              <h1>Explore highlights</h1>
              <p className="message">Browse the saved passages in page order or filter by what you want to find.</p>
              <div className="filters" role="group" aria-label="Highlight categories">
                {availableRoles.map(role => <button key={role} title={roles[role]} style={facet(role)} aria-pressed={selection?.enabled.has(role)}
                  onClick={() => reader.current?.toggle(role)}><i className="swatch"/>{LABELS[role]}</button>)}
              </div>
              <div className="explore-meta">
                <span>{shown.size} shown · use the page margin for local changes</span>
                <button className="quiet" onClick={() => reader.current?.reset()}>Reset</button>
              </div>
              {explore.map(candidate => <article className="explore-item" key={candidate.id}>
                <button className="explore-title" onClick={() => jump(candidate.id)} aria-current={candidate === selected ? 'true' : undefined}>
                  <i className="swatch" style={facet(candidate.role)}/><span>{candidate.label}</span><small>p. {candidate.anchors[0].page}</small>
                </button>
                {candidate === selected && <>
                  {showPassage(candidate)}
                  {candidate.purpose && <p className="reading-note">{candidate.purpose}</p>}
                  {related(candidate)}
                </>}
              </article>)}
              {!explore.length && <p className="message">Enable a category to show passages here.</p>}
            </> : null}
        </div>
        {ready && mode === 'focus' && stop && <nav className="stop-nav" aria-label="Reading stops">
          <button onClick={() => stopIndex === 0 ? reader.current?.clearStop() : go(stopIndex - 1)}>← {stopIndex ? 'Previous' : 'Overview'}</button>
          {data && stopIndex + 1 < data.route.length
            ? <button className="primary" onClick={() => go(stopIndex + 1)}>Next stop →</button>
            : <button className="primary" onClick={() => setMode('explore')}>Explore more →</button>}
        </nav>}
      </aside>
    </main>
    <div id="status" className="sr-only" role="status">{snapshot.status}</div>
  </div>;
}
