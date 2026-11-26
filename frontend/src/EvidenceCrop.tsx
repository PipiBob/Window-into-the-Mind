import {useEffect, useState} from 'react';
import type {Reader} from './reader';
import type {VisualEvidence} from './types';

export function EvidenceCrop({reader, visual}: {reader: Reader; visual: VisualEvidence}) {
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let url = '';
    setImage('');
    setFailed(false);
    void reader.cropEvidence(visual).then(blob => {
      if (disposed) return;
      url = URL.createObjectURL(blob);
      setImage(url);
    }).catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [reader, visual]);

  return <figure className="finding-evidence">
    <figcaption>{visual.label}</figcaption>
    {image ? <img src={image} alt={visual.label} /> :
      <p role="status">{failed ? 'Preview unavailable. Open the original PDF below.' : 'Loading evidence from the PDF…'}</p>}
    {visual.note && <p className="reading-note">{visual.note}</p>}
    <div className="finding-evidence-actions">
      {image && <a href={image} target="_blank" rel="noopener">Enlarge ↗</a>}
      <button className="quiet" onClick={() => reader.showPdfLocation(visual.page, visual.box)}>
        View in PDF · p. {visual.page}
      </button>
    </div>
  </figure>;
}
