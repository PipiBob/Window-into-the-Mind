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
  useEffect(() => {panel.current?.scrollTo(0, 0);}, [snapshot.paper, mode]);
  const stop = data?.route[stopIndex];
  const candidates = new Map(data?.candidates.map(candidate => [candidate.id, candidate]));
  const primary = stop ? candidates.get(stop.id) : undefined;
  const companions = stop?.context.map(id => candidates.get(id)!) ?? [];
  const evidence = companions.filter(candidate => candidate.anchors.some(anchor => anchor.region));
  const connectionRoles = ['objective', 'method', 'result'] as const;
  const evidenceIds = new Set(evidence.map(candidate => candidate.id));
  const linked = primary && stop ? [...candidates.values()].filter(candidate =>
    candidate.id !== primary.id && !evidenceIds.has(candidate.id) &&
    (stop.context.includes(candidate.id) || primary.related_to.includes(candidate.id) || candidate.related_to.includes(primary.id))
  ) : [];
  const selected = selection?.selected ? candidates.get(selection.selected) : undefined;
  const detour = stop && selected && selected !== primary ? selected : undefined;
  const detourIsEvidence = Boolean(detour && evidenceIds.has(detour.id));
  const shown = data && selection ? selectedIds(data, selection) : new Set<string>();
  const availableRoles = ROLES.filter(role => data?.candidates.some(candidate => candidate.role === role));
  const legendRoles = availableRoles.filter(role => data?.candidates.some(candidate => candidate.role === role && shown.has(candidate.id)));
  const explore = (data?.candidates ?? []).filter(candidate => shown.has(candidate.id))
    .sort((a, b) => a.anchors[0].page - b.anchors[0].page || a.anchors[0].boxes[0][1] - b.anchors[0].boxes[0][1]);
  const go = (index: number) => reader.current?.goToStop(index);
  const step = (index: number) => {
    go(index);
    requestAnimationFrame(() => panel.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block: 'nearest'}));
  };
  const jump = (id: string, index = 0) => {
    reader.current?.jumpTo(id, index);
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

  const activeDetails = stop && data && <section className="active-stop" id="active-stop" aria-labelledby={`route-stop-${stopIndex}`}>
    <div className="stop-progress" aria-live="polite">Stop {stopIndex + 1} of {data.route.length}</div>
    {stop.note && <p className="reading-note">{stop.note}</p>}
    {primary && showPassage(primary)}
    {evidence.length > 0 && <div className="context">
      <h2>See the evidence</h2>
      {evidence.map(showPassage)}
    </div>}
    {linked.length > 0 && <nav className="research-links context" aria-label="Connected passages">
      <h2>How this passage connects</h2>
      {[...connectionRoles, 'novelty', 'caveat'].flatMap(role => linked.filter(candidate => candidate.role === role).map(candidate =>
        <div key={candidate.id}>
          <button style={facet(candidate.role)} onClick={() => jump(candidate.id)}
            aria-current={selected?.id === candidate.id ? 'location' : undefined}>
            <i className="swatch" aria-hidden="true"/><span><small>{roles[candidate.role]}</small>{candidate.label}</span>
            <small>p. {candidate.anchors[0].page} ↗</small>
          </button>
          {detour?.id === candidate.id && <div className="detour">
            {showPassage(candidate)}
            <button className="quiet" onClick={() => go(stopIndex)}>← Back to this stop</button>
          </div>}
        </div>))}
    </nav>}
    {detour && !linked.some(candidate => candidate.id === detour.id) && <div className="detour">
      {!detourIsEvidence && <><h2>{detour.label}</h2>{showPassage(detour)}</>}
      <button className="quiet" onClick={() => go(stopIndex)}>← Back to this stop</button>
    </div>}
    {primary?.purpose && <details className="why"><summary>Why this passage?</summary><p>{primary.purpose}</p></details>}
  </section>;

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
        <div className="panel-content" ref={panel} key={snapshot.paper}>
          {snapshot.status.startsWith('Unable') ? <p className="message">{snapshot.status}</p> : !ready || !data ? <p className="message">Opening the original paper…</p> :
            mode === 'focus' ? <>
              <nav className="route" aria-labelledby="reading-path-title">
                <h1 id="reading-path-title">Reading path</h1>
                <ol>{data.route.map((item, index) => {
                  const candidate = candidates.get(item.id)!;
                  const expanded = index === stopIndex;
                  return <li key={item.id}>
                    <button className="route-stop" id={`route-stop-${index}`} style={facet(candidate.role)}
                      aria-expanded={expanded} aria-current={expanded ? 'step' : undefined}
                      aria-controls={expanded ? 'active-stop' : undefined}
                      onClick={event => {
                        const row = event.currentTarget;
                        const top = row.getBoundingClientRect().top;
                        if (expanded) reader.current?.clearStop();
                        else go(index);
                        requestAnimationFrame(() => panel.current?.scrollBy(0, row.getBoundingClientRect().top - top));
                      }}>
                      <i className="swatch" aria-hidden="true"/><span>{item.title}</span>
                      <small>p. {candidate.anchors[0].page} <span className="route-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span></small>
                    </button>
                    {expanded && activeDetails}
                  </li>;
                })}</ol>
              </nav>
              {!stop && <div className="intro">
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
              </div>}

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
          <button onClick={() => stopIndex === 0 ? reader.current?.clearStop() : step(stopIndex - 1)}>← {stopIndex ? 'Previous' : 'Overview'}</button>
          {data && stopIndex + 1 < data.route.length
            ? <button className="primary" onClick={() => step(stopIndex + 1)}>Next stop →</button>
            : <button className="primary" onClick={() => setMode('explore')}>Explore more →</button>}
        </nav>}
      </aside>
    </main>
    <div id="status" className="sr-only" role="status">{snapshot.status}</div>
  </div>;
}
