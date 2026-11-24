import React, { useEffect, useMemo, useRef } from 'react';
import { buildWorld, startCorridor } from './corridorEngine';
import './caseCorridor.css';

/* Timeline layout of the Graph explorer: Ayaana's "walk through the case" prototype
   (index3d.html) running on the real case graph. The engine draws on a canvas and fills
   the legend, radar, story panel and time bar below. */
export default function CaseCorridor({ graph, analysis, onSelect, onLayout, height = '760px' }) {
  const root = useRef(null);
  const world = useMemo(() => buildWorld(graph, analysis), [graph, analysis]);
  const cb = useRef({});
  cb.current = { onSelect, onLayout };

  useEffect(() => {
    if (!root.current || world.empty) return undefined;
    return startCorridor(root.current, world, {
      onPick: raw => cb.current.onSelect?.(raw),
      onLayout: m => cb.current.onLayout?.(m)
    });
  }, [world]);

  const layoutSwitch = (
    <div className="cc-layout" role="group" aria-label="Graph layout">
      <button type="button" data-layout="timeline" className="on" onClick={() => onLayout?.('timeline')}>Timeline</button>
      <button type="button" data-layout="network" onClick={() => onLayout?.('network')}>Network</button>
    </div>
  );

  if (world.empty) {
    return (
      <div className="cc cc-empty" style={{ height }}>
        {layoutSwitch}
        <div><b>No entities in this case yet</b><span>Import records or load the sample data to walk through its timeline.</span></div>
      </div>
    );
  }

  return (
    <div className="cc" ref={root} style={{ height }} key={graph?.case_ids?.join(',') || 'case'}>
      <div className="cc-stage">
        <canvas className="cc-c" />
        <div className="cc-legend" />
        <div className="cc-tip" />
        <canvas className="cc-mini" width="560" height="240" />
        {layoutSwitch}
        <div className="cc-sbar" title="Jump through time"><div className="cc-sthumb" /></div>
        <div className="cc-cue"><i />Scroll to travel through time</div>
        <div className="cc-hint">W A S D walk · Q / E down / up · drag = look · <b>scroll = travel through time</b> · click an entity = fly to it · click radar = jump · Shift = fast · Space = play</div>
      </div>
      <div className="cc-panel" />
      <div className="cc-bar">
        <button type="button" className="cc-play" title="Fly through time">▶</button>
        <div className="cc-track"><div className="cc-ticks" /><input className="cc-range" type="range" min="-8" max="33" step="0.01" defaultValue="-6" aria-label="Scrub through time" /></div>
        <div className="cc-read"><div className="cc-date" /><div className="cc-cnt" /></div>
      </div>
    </div>
  );
}
