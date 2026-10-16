'use client';

import { useEffect, useRef } from 'react';
// Type-only imports; runtimes are dynamic-imported below to avoid HTMLElement
// access during Next.js server rendering.
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';
import type { Visualizer as SrVisualizer } from 'sr-puzzlegen';
import { layoutSquare1, paddedViewBox, type Box, type Square1Part } from './square1Layout';

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

// sr-puzzlegen internals reached by the Square-1 layout. A part is either a
// Group (top/bottom layer: `objects`) or a Geometry (pieces, middle slice:
// `faces`); HtmlSvgRenderer keeps one <polygon> per face uid.
interface SrNode { objects?: SrNode[]; faces?: { uid: number | string }[] }
interface SrSvgRenderer {
  domElement: HTMLDivElement;
  svgElement: SVGSVGElement;
  uidToPolygon: Record<string, SVGPolygonElement | undefined>;
  strokeWidth: string;
}

// Padding around the measured drawing, as a fraction of its larger side.
const SQ1_PAD_RATIO = 0.04;

/** Moves an sr-puzzlegen object to (x, y) without touching its rotation —
 *  each Square-1 net part's matrix is T·R, so the translation column is
 *  exactly its on-screen origin. */
function placeAt(object: SrObject3D, x: number, y: number): void {
  object.matrix.values[12] = x;
  object.matrix.values[13] = y;
}

function collectFaceUids(node: SrNode, out: string[] = []): string[] {
  node.faces?.forEach((f) => out.push(String(f.uid)));
  node.objects?.forEach((child) => collectFaceUids(child, out));
  return out;
}

/** Bounds of the given polygons' points, in SVG user units. */
function polygonBounds(polygons: readonly SVGPolygonElement[]): Box | null {
  let box: Box | null = null;
  for (const polygon of polygons) {
    const pts = polygon.points;
    for (let i = 0; i < pts.numberOfItems; i++) {
      const { x, y } = pts.getItem(i);
      box = box
        ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return box;
}

/** Static/interactive cube-state preview for a given scramble string.
 *  Square-1 uses sr-puzzlegen (static SVG net, re-stacked vertically by
 *  square1Layout.ts) — @cubing/twisty's own Square-1 3D rendering wasn't
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
  // The stock 'square1-net' spaces its parts too tightly (turned corners
  // overlap), so layoutSquare1 re-stacks top / middle / bottom using each
  // part's measured bounds for THIS scramble, and the viewBox is then fit
  // to the whole drawing plus padding. SVG() gives the <svg> fixed
  // width/height attributes and wraps it in its own unsized
  // <div class="svg-renderer">; the attributes are dropped and both get
  // h-full/w-full so preserveAspectRatio="xMidYMid meet" centres the drawing
  // as large as the container allows.
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
          puzzle: { alg: scramble },
        });
        const renderer = (vis as unknown as { renderer: SrSvgRenderer }).renderer;
        const [top, bottom, middle] = vis.puzzleGeometry.group.objects;
        const parts: Record<Square1Part, SrObject3D> = { top, middle, bottom };
        const uids: Record<Square1Part, string[]> = {
          top: collectFaceUids(top as unknown as SrNode),
          middle: collectFaceUids(middle as unknown as SrNode),
          bottom: collectFaceUids(bottom as unknown as SrNode),
        };
        const bounds = layoutSquare1({
          place: (part, x, y) => placeAt(parts[part], x, y),
          render: () => vis.render(),
          measure: (part) => polygonBounds(
            uids[part].flatMap((uid) => renderer.uidToPolygon[uid] ?? []),
          ),
        });
        const { domElement, svgElement } = renderer;
        if (bounds) {
          const vb = paddedViewBox(bounds, SQ1_PAD_RATIO, parseFloat(renderer.strokeWidth) || 0);
          svgElement.setAttribute('viewBox', `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
        }
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgElement.removeAttribute('width');
        svgElement.removeAttribute('height');
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
        className="flex h-full w-full items-center justify-center"
      />
    </div>
  );
}
