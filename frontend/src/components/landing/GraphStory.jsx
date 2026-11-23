import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { startStory } from './storyCanvas';

/* "The story" section: records → network in five phases (GraphStory design).
   The section is tall and its stage is sticky, so scrolling through it scrubs the story.
   When the visitor stops scrolling, it plays on its own. Reduced motion shows the final state. */

const STEPS = [
  ['Import', 'Bring every record in', 'Statements, call logs, case narratives and history files arrive as separate documents.'],
  ['Extract', 'Find who is involved', 'People, accounts, phones and places lift out of each record. Every dot remembers the line it came from.'],
  ['Resolve', 'Recognise the same person', '“R. Menon” and “Ravi Menon” share an account number, so their two dots merge into one.'],
  ['Connect', 'See across cases', 'Links draw in, and one person turns up in both cases, joining two investigations.'],
  ['Trace', 'Follow the money to its source', 'Three accounts pass money in a loop. It lights up as a possible route, with the exact statement row behind it.']
];
const KEY = [['People', '#5AA9FF'], ['Accounts', '#F2B544'], ['Phones', '#3DD6B5'], ['Places', '#A98BFF']];
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function GraphStory() {
  const [reduced] = useState(reducedMotion);
  const [step, setStep] = useState(reduced ? 4 : 0);
  const [playing, setPlaying] = useState(!reduced);
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const captionRef = useRef(null);
  const ctl = useRef({ pt: reduced ? 5 : 0, playing: !reduced, hold: 0, scrubAt: 0, visible: false });

  // Canvas renderer
  useEffect(() => startStory(canvasRef.current, ctl.current, setStep, reduced), [reduced]);

  // The page renders after load, so the browser can't jump to #story by itself.
  useEffect(() => {
    if (window.location.hash === '#story') sectionRef.current?.scrollIntoView();
  }, []);

  // Tell the renderer where the caption ends, so the graph centres in the space to its right.
  useEffect(() => {
    const cap = captionRef.current, stage = stageRef.current;
    const measure = () => { ctl.current.leftEdge = cap.getBoundingClientRect().right - stage.getBoundingClientRect().left + 24; };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(cap); ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // Only draw while the stage is on screen.
  useEffect(() => {
    const el = stageRef.current;
    if (!('IntersectionObserver' in window)) { ctl.current.visible = true; return undefined; }
    const io = new IntersectionObserver(([e]) => { ctl.current.visible = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Scroll scrub: while the stage is pinned, page scroll moves the story forward or back.
  useEffect(() => {
    if (reduced) return undefined;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, dy = y - lastY; lastY = y;
      const sec = sectionRef.current; if (!sec) return;
      const r = sec.getBoundingClientRect(), vh = window.innerHeight;
      if (r.top > 0 || r.bottom < vh) return; // not pinned
      const span = Math.max(1, sec.offsetHeight - vh);
      const c = ctl.current;
      c.pt = Math.max(0, Math.min(5, c.pt + (dy / span) * 5));
      c.hold = 0;
      c.scrubAt = performance.now();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  const pick = i => {
    const c = ctl.current;
    c.pt = i + 0.999; c.playing = false; c.hold = 0;
    setStep(i); setPlaying(false);
  };
  const toggle = () => {
    const c = ctl.current, pl = !c.playing;
    c.playing = pl; c.scrubAt = 0;
    if (pl && c.pt >= 5) { c.pt = 0; c.hold = 0; }
    setPlaying(pl);
  };
  const [, title, body] = STEPS[step];

  return (
    <section id="story" ref={sectionRef} aria-label="The story: from records to a network"
      className={cn('tw:relative', reduced ? 'tw:h-auto' : 'tw:h-[230vh] tw:max-sm:h-[190vh]')}>
      <div ref={stageRef}
        className="tw:sticky tw:top-0 tw:h-screen tw:min-h-[560px] tw:overflow-hidden tw:bg-[radial-gradient(900px_700px_at_62%_45%,rgb(90_169_255/10%),transparent_70%)]">
        <canvas ref={canvasRef} role="img"
          aria-label="Animated story: documents release people, accounts, phones and places; duplicates merge; links connect two cases; a money loop lights up with its source statement row. Hover a dot to see its source."
          className="tw:absolute tw:inset-0 tw:block tw:size-full" />
        <div aria-hidden="true"
          className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-[linear-gradient(90deg,#0A1020_0%,rgb(10_16_32/75%)_26%,transparent_46%)] tw:max-[900px]:bg-[linear-gradient(180deg,#0A1020_0%,rgb(10_16_32/85%)_30%,transparent_48%)]" />

        <div ref={captionRef} className="tw:pointer-events-none tw:absolute tw:top-[calc(50%-28px)] tw:left-[max(16px,4.5vw)] tw:grid tw:w-[min(440px,38vw)] tw:-translate-y-1/2 tw:gap-[18px] tw:max-[900px]:top-[76px] tw:max-[900px]:w-[calc(100%-32px)] tw:max-[900px]:translate-y-0 tw:max-[900px]:gap-2.5">
          <p className="tw:m-0 tw:font-mono tw:text-[13px] tw:tracking-[0.08em] tw:text-gold tw:max-sm:text-[11px]">
            THE STORY · STEP {String(step + 1).padStart(2, '0')} OF 05
          </p>
          <div key={step} className="tw:grid tw:animate-lp-rise tw:gap-4 tw:max-[900px]:gap-2" aria-live="polite">
            <h2 className="tw:m-0 tw:font-display tw:text-[clamp(28px,3.4vw,46px)] tw:leading-[1.06] tw:font-bold tw:tracking-[-0.03em] tw:text-balance">{title}</h2>
            <p className="tw:m-0 tw:text-[clamp(15px,1.3vw,18px)] tw:leading-[1.6] tw:text-pretty tw:text-ink-2">{body}</p>
          </div>
          <ul aria-label="What the colours mean" className="tw:m-0 tw:mt-1.5 tw:flex tw:w-fit tw:justify-self-start tw:list-none tw:flex-wrap tw:gap-x-3 tw:gap-y-2 tw:rounded-xl tw:border tw:border-line tw:bg-surface/60 tw:px-3.5 tw:py-2.5 tw:text-[13px] tw:whitespace-nowrap tw:text-ink-3 tw:max-[900px]:hidden">
            {KEY.map(([k, c]) => (
              <li key={k} className="tw:flex tw:items-center tw:gap-2"><i className="tw:size-[9px] tw:rounded-full" style={{ background: c }} />{k}</li>
            ))}
            <li className="tw:flex tw:items-center tw:gap-2"><i className="tw:h-0.5 tw:w-4 tw:bg-coral" />Money loop</li>
          </ul>
        </div>

        <div className="tw:absolute tw:inset-x-[max(16px,4.5vw)] tw:bottom-[clamp(20px,5vh,44px)] tw:flex tw:items-center tw:gap-2.5 tw:max-[900px]:flex-wrap">
          <div role="group" aria-label="Story steps"
            className="tw:flex tw:gap-2.5 tw:overflow-x-auto tw:[scrollbar-width:none] tw:max-[900px]:w-full tw:max-[900px]:gap-2">
            {STEPS.map(([short], i) => {
              const state = i === step ? 'on' : i < step ? 'done' : '';
              return (
                <button key={short} type="button" aria-pressed={i === step} onClick={() => pick(i)}
                  className={cn(
                    'tw:flex tw:min-h-12 tw:shrink-0 tw:cursor-pointer tw:items-center tw:gap-2.5 tw:rounded-full tw:border tw:border-line tw:bg-[rgb(13_21_39/85%)] tw:py-0 tw:pr-4 tw:pl-1.5 tw:font-display tw:text-[15px] tw:font-semibold tw:text-ink tw:transition-[translate,border-color,background-color] tw:duration-200 tw:hover:-translate-y-0.5 tw:hover:border-[#4C8FE0] tw:max-sm:min-h-11 tw:max-sm:text-sm',
                    state === 'on' && 'tw:border-gold tw:bg-surface'
                  )}>
                  <span className={cn(
                    'tw:grid tw:size-9 tw:place-items-center tw:rounded-full tw:border tw:border-[#2F4266] tw:font-mono tw:text-xs tw:font-normal tw:text-ink-3 tw:transition-all tw:max-sm:size-8',
                    state === 'done' && 'tw:border-gold tw:text-gold',
                    state === 'on' && 'tw:border-gold tw:bg-gold tw:text-night'
                  )}>{String(i + 1).padStart(2, '0')}</span>
                  {short}
                </button>
              );
            })}
          </div>
          <span className="tw:flex-1 tw:max-[900px]:hidden" />
          <span className="tw:text-[13px] tw:text-ink-4 tw:max-[1300px]:hidden">Scroll to move through the story · hover a dot for its source</span>
          {!reduced && (
            <button type="button" onClick={toggle} aria-label={playing ? 'Pause story' : 'Play story'}
              className="tw:flex tw:min-h-12 tw:shrink-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-full tw:border-0 tw:bg-gold tw:px-5 tw:py-0 tw:text-sm tw:font-semibold tw:text-night tw:transition-[translate,box-shadow] tw:duration-200 tw:hover:-translate-y-0.5 tw:hover:shadow-[0_0_0_6px_rgb(242_181_68/16%)] tw:max-sm:min-h-11">
              {playing
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>}
              {playing ? 'Pause' : 'Play story'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
