'use client';

import { useEffect, useRef } from 'react';
// Type-only import; runtime is dynamic-imported below to avoid HTMLElement
// access during Next.js server rendering.
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';

// Map an event id → TwistyPlayer puzzle id. Two id schemes reach this
// component from different callers — lib/wca-events.ts's WCA-standard ids
// ('333bf', '444bf', '555bf', used by admin/results pages) and the Timer
// page's own local EVENTS array ('333bld', '444bld', '555bld') — so the
// three Blindfolded events are listed under both spellings. Every other id
// already matches across both schemes. Events not in this map fall back to
// "Preview not available".
const PUZZLE_MAP: Record<string, string> = {
  '333':    '3x3x3',
  '333oh':  '3x3x3',
  '333bf':  '3x3x3', '333bld': '3x3x3',
  '333mbf': '3x3x3',
  '333fm':  '3x3x3',
  '222':    '2x2x2',
  '444':    '4x4x4',
  '444bf':  '4x4x4', '444bld': '4x4x4',
  '555':    '5x5x5',
  '555bf':  '5x5x5', '555bld': '5x5x5',
  '666':    '6x6x6',
  '777':    '7x7x7',
  'pyram':  'pyraminx',
  'skewb':  'skewb',
  'sq1':    'square1',
  'clock':  'clock',
  'minx':   'megaminx',
};

/** Static/interactive cube-state preview for a given scramble string.
 *  Square-1 uses sr-puzzlegen (static SVG, rendered at a fixed natural size
 *  then scaled to fit via CSS) — @cubing/twisty's own Square-1 3D rendering
 *  wasn't reliable enough, so this one puzzle deliberately gets a different
 *  renderer. Renders the 'square1-net' puzzle type (flat top/bottom pentagon
 *  nets, TNoodle's standard style) rather than 'square1' (a 3D-perspective
 *  render) — the canvas size and viewBox below are fit to that net's actual
 *  geometry (measured programmatically: x in [-0.46, 0.50], y in [-0.87,
 *  0.87] across 200 random scrambles), which is portrait or ~0.6:1
 *  width:height, not square. Every other puzzle uses @cubing/twisty's
 *  TwistyPlayer (3D WebGL with native drag).
 *
 *  Renders a STATE, not a scramble — experimentalSetupAlg synchronously
 *  parses `scramble` and applies it to the puzzle, no Web Worker involved
 *  (unlike @cubing/scramble's random-scramble *generation*, which spins up
 *  a Worker that fails under this project's Next.js bundler — see
 *  app/api/scramble/route.ts). Safe to use anywhere scramble generation
 *  itself isn't.
 *
 *  Sizing is caller-controlled: the root fills its parent (flex: 1 1 auto),
 *  so wrap this in a fixed-size/aspect-ratio container. */
export default function ScramblePreview({ eventId, scramble }: { eventId: string; scramble: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sq1MountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwistyPlayerType | null>(null);
  const puzzleId = PUZZLE_MAP[eventId];
  const isSq1 = puzzleId === 'square1';

  // Square-1: sr-puzzlegen's SVG() sets fixed width/height *attributes* on
  // the <svg> it creates — those act as concrete replaced-element sizing,
  // NOT an intrinsic ratio the flexbox parent can shrink automatically (a
  // <div style="width:100%"> around it does nothing on its own). So after
  // creating it we override width/height to 100% via CSS: the <svg>'s
  // default preserveAspectRatio="xMidYMid meet" then letterboxes the
  // viewBox content to fit the container, uniformly scaled, no distortion.
  // The viewBox (minx/miny/svgWidth/svgHeight) is fit to 'square1-net's
  // actual geometry — measured programmatically: x in [-0.46, 0.50], y in
  // [-0.87, 0.87] across 200 random scrambles (portrait, ~0.6:1 w:h).
  //
  // SVG()'s renderer also inserts its own wrapper <div class="svg-renderer">
  // around the <svg> (HtmlSvgRenderer.domElement, internal to sr-puzzlegen —
  // not something the caller normally sees). That div has no size of its
  // own, so it sizes to 'auto', which makes it an INDEFINITE containing
  // block — the <svg>'s height:100% then has nothing definite to resolve
  // against and silently falls back to sizing from its intrinsic viewBox
  // aspect ratio instead, blowing past the real container (confirmed via
  // a live-browser check: computed height came out as exactly
  // svgWidth * (viewBoxHeight/viewBoxWidth), ignoring the container).
  // Sizing that wrapper div to 100%/100% too closes the gap.
  useEffect(() => {
    if (!isSq1 || !sq1MountRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { SVG } = await import('sr-puzzlegen');
        if (cancelled || !sq1MountRef.current) return;
        sq1MountRef.current.innerHTML = '';
        const vis = SVG(sq1MountRef.current, 'square1-net' as Parameters<typeof SVG>[1], {
          width: 240, height: 400,
          minx: -0.6, miny: -1.0, svgWidth: 1.2, svgHeight: 2.0,
          puzzle: { alg: scramble },
        });
        const { domElement, svgElement } = (vis as unknown as {
          renderer: { domElement: HTMLElement; svgElement: SVGElement };
        }).renderer;
        domElement.style.width = '100%';
        domElement.style.height = '100%';
        svgElement.style.width = '100%';
        svgElement.style.height = '100%';
        svgElement.style.display = 'block';
      } catch (err) {
        console.warn('sr-puzzlegen SQ1 render failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isSq1, scramble]);

  // All other puzzles: TwistyPlayer 3D
  useEffect(() => {
    if (isSq1 || !puzzleId) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('cubing/twisty');
        if (cancelled || !containerRef.current) return;
        const player = new mod.TwistyPlayer({
          puzzle: puzzleId, experimentalSetupAlg: scramble, alg: '',
          background: 'none', controlPanel: 'none', viewerLink: 'none',
          hintFacelets: 'none', backView: 'none', visualization: '3D',
        } as unknown as ConstructorParameters<typeof mod.TwistyPlayer>[0]);
        const el = player as unknown as HTMLElement;
        el.style.width = '100%'; el.style.height = '100%';
        el.style.background = 'transparent';
        containerRef.current.appendChild(el);
        playerRef.current = player;
      } catch (err) { console.warn('TwistyPlayer load failed', err); }
    })();
    return () => {
      cancelled = true;
      const player = playerRef.current as unknown as HTMLElement | null;
      const c = containerRef.current;
      if (player && c && c.contains(player)) c.removeChild(player);
      playerRef.current = null;
    };
  }, [puzzleId, isSq1]);

  useEffect(() => {
    if (isSq1) return;
    const player = playerRef.current;
    if (!player || !puzzleId) return;
    try {
      (player as unknown as { experimentalSetupAlg: string }).experimentalSetupAlg = scramble;
      (player as unknown as { alg: string }).alg = '';
    } catch (err) { console.warn('TwistyPlayer update failed', err); }
  }, [scramble, puzzleId, isSq1]);

  if (!puzzleId) {
    return (
      <div style={{
        flex: '1 1 auto', minHeight: 0, width: '100%', fontSize: '0.72rem', color: 'var(--muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 0.5rem',
      }}>
        Preview not available for this puzzle.
      </div>
    );
  }

  if (isSq1) {
    return (
      <div style={{
        flex: '1 1 auto', minHeight: 0, width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        <div ref={sq1MountRef} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{
      flex: '1 1 auto', minHeight: 0, width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} />
  );
}
