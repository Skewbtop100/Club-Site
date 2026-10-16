'use client';

import { useEffect, useRef } from 'react';
// Type-only imports; runtimes are dynamic-imported below to avoid HTMLElement
// access during Next.js server rendering.
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';
import type { Visualizer as SrVisualizer } from 'sr-puzzlegen';

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

type Visualization = '3D' | '2D';
type SrObject3D = SrVisualizer['puzzleGeometry']['group']['objects'][number];

// Square-1 net layout, in sr-puzzlegen's pre-scale puzzle units. The stock
// 'square1-net' stacks top layer / middle slice / bottom layer only
// outerHalfSide apart, but a layer's corners reach outerHalfSide·√2 from its
// centre, so rotated layers overlap each other and the middle slice. We
// instead place the layers side by side (top left, bottom right) with a gap,
// and the middle slice centred underneath — a ~1.6:1 drawing that fills the
// roughly-square preview cards far better than a tall 1:2 stack.
const SQ1_LAYER_X = 0.72;   // |x| of each layer centre (layer radius ≈ 0.594)
const SQ1_MIDDLE_Y = 0.84;  // y of the middle slice (positive = below on screen)
// Rendered bounds of that layout, measured programmatically over 300 random
// legal scrambles: x in [-1.035, 1.035], y in [-0.459, 0.742]. The viewBox
// adds ~0.08 of padding on every side so strokes never touch the edge.
const SQ1_VIEWBOX = { minx: -1.12, miny: -0.54, svgWidth: 2.24, svgHeight: 1.37 } as const;

/** Moves an sr-puzzlegen object to (x, y) without touching its rotation —
 *  each Square-1 net part's matrix is T·R, so the translation column is
 *  exactly its on-screen origin. */
function placeAt(object: SrObject3D, x: number, y: number): void {
  object.matrix.values[12] = x;
  object.matrix.values[13] = y;
}

/** Static/interactive cube-state preview for a given scramble string.
 *  Square-1 uses sr-puzzlegen (static SVG net, re-laid-out side by side —
 *  see SQ1_* above) — @cubing/twisty's own Square-1 3D rendering wasn't
 *  reliable enough, so this one puzzle deliberately gets a different
 *  renderer. Every other puzzle uses @cubing/twisty's TwistyPlayer (3D WebGL
 *  with native drag).
 *
 *  Renders a STATE, not a scramble — experimentalSetupAlg synchronously
 *  parses `scramble` and applies it to the puzzle, no Web Worker involved
 *  (unlike @cubing/scramble's random-scramble *generation*, which spins up
 *  a Worker that fails under this project's Next.js bundler — see
 *  app/api/scramble/route.ts). Safe to use anywhere scramble generation
 *  itself isn't.
 *
 *  `visualization` picks the render mode for the TwistyPlayer puzzles:
 *  '3D' (default) is the rotated cube every existing caller uses, '2D' is
 *  the flat unfolded net in the WCA scramble-PDF style. Only the
 *  online-competition scramble list opts into '2D'. Square-1 ignores it.
 *
 *  Sizing is caller-controlled: the root fills its parent (flex: 1 1 auto),
 *  so wrap this in a fixed-size/aspect-ratio container. */
export default function ScramblePreview({
  eventId,
  scramble,
  visualization = '3D',
}: {
  eventId: string;
  scramble: string;
  visualization?: Visualization;
}) {
  const puzzleId = PUZZLE_MAP[eventId];

  if (!puzzleId) {
    return (
      <div className="flex min-h-0 w-full flex-auto items-center justify-center px-2 text-center text-[0.72rem] text-[var(--muted)]">
        Preview not available for this puzzle.
      </div>
    );
  }

  // Keyed by puzzle + mode so a puzzle switch is a full React remount: the
  // old mount node (and anything imperatively rendered into it) is dropped
  // from the DOM wholesale. Scramble changes within a puzzle update in place
  // so the TwistyPlayer's WebGL context isn't rebuilt on every solve.
  return (
    <PuzzlePreview
      key={`${puzzleId}-${visualization}`}
      puzzleId={puzzleId}
      scramble={scramble}
      visualization={visualization}
    />
  );
}

/** Owns one mount node whose children are managed exclusively here (React
 *  renders it empty). Every render path clears it with replaceChildren()
 *  first, and a monotonic token discards any async render that resolves
 *  after a newer one started or after unmount — so the node only ever holds
 *  the preview for the current puzzle + scramble. */
function PuzzlePreview({
  puzzleId,
  scramble,
  visualization,
}: {
  puzzleId: string;
  scramble: string;
  visualization: Visualization;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<number>(0);
  const playerRef = useRef<TwistyPlayerType | null>(null);
  // Latest scramble, read by the TwistyPlayer creator after its await so a
  // scramble that changed mid-import isn't lost.
  const scrambleRef = useRef<string>(scramble);
  const isSq1 = puzzleId === 'square1';

  useEffect(() => { scrambleRef.current = scramble; }, [scramble]);

  // Square-1: sr-puzzlegen SVG, re-rendered per scramble (cheap, no WebGL).
  // SVG() gives the <svg> fixed width/height attributes and wraps it in its
  // own unsized <div class="svg-renderer">; both get h-full/w-full so the
  // svg's default preserveAspectRatio="xMidYMid meet" letterboxes the
  // viewBox into the container, uniformly scaled.
  useEffect(() => {
    const mount = mountRef.current;
    if (!isSq1 || !mount) return;
    const token = ++tokenRef.current;
    (async () => {
      try {
        const { SVG } = await import('sr-puzzlegen');
        if (token !== tokenRef.current) return;
        mount.replaceChildren();
        const vis = SVG(mount, 'square1-net' as Parameters<typeof SVG>[1], {
          width: 448, height: 274,
          ...SQ1_VIEWBOX,
          puzzle: { alg: scramble },
        });
        const [top, bottom, middle] = vis.puzzleGeometry.group.objects;
        placeAt(top, -SQ1_LAYER_X, 0);
        placeAt(bottom, SQ1_LAYER_X, 0);
        placeAt(middle, 0, SQ1_MIDDLE_Y);
        vis.render();
        const { domElement, svgElement } = (vis as unknown as {
          renderer: { domElement: HTMLElement; svgElement: SVGElement };
        }).renderer;
        domElement.classList.add('h-full', 'w-full');
        svgElement.classList.add('block', 'h-full', 'w-full');
      } catch (err) {
        if (token === tokenRef.current) mount.replaceChildren();
        console.warn('sr-puzzlegen SQ1 render failed', err);
      }
    })();
    return () => {
      tokenRef.current++;
      mount.replaceChildren();
    };
  }, [isSq1, scramble]);

  // All other puzzles: one TwistyPlayer per mount, built once.
  useEffect(() => {
    const mount = mountRef.current;
    if (isSq1 || !mount) return;
    const token = ++tokenRef.current;
    mount.replaceChildren();
    (async () => {
      try {
        const mod = await import('cubing/twisty');
        if (token !== tokenRef.current) return;
        const player = new mod.TwistyPlayer({
          puzzle: puzzleId, experimentalSetupAlg: scrambleRef.current, alg: '',
          background: 'none', controlPanel: 'none', viewerLink: 'none',
          hintFacelets: 'none', backView: 'none', visualization,
        } as unknown as ConstructorParameters<typeof mod.TwistyPlayer>[0]);
        const el = player as unknown as HTMLElement;
        el.classList.add('h-full', 'w-full', 'bg-transparent');
        mount.replaceChildren(el);
        playerRef.current = player;
      } catch (err) { console.warn('TwistyPlayer load failed', err); }
    })();
    return () => {
      tokenRef.current++;
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [puzzleId, isSq1, visualization]);

  // Scramble change on an existing TwistyPlayer: update its state in place.
  // If the player is still loading, the creator above picks up the latest
  // scramble from scrambleRef instead.
  useEffect(() => {
    const player = playerRef.current;
    if (isSq1 || !player) return;
    try {
      (player as unknown as { experimentalSetupAlg: string }).experimentalSetupAlg = scramble;
      (player as unknown as { alg: string }).alg = '';
    } catch (err) { console.warn('TwistyPlayer update failed', err); }
  }, [scramble, isSq1]);

  return (
    <div className="flex min-h-0 w-full flex-auto items-center justify-center overflow-hidden">
      <div
        ref={mountRef}
        className={isSq1
          ? 'flex h-full w-full items-center justify-center p-1'
          : 'flex h-full w-full items-center justify-center'}
      />
    </div>
  );
}
