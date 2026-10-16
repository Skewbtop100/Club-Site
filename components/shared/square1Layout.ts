// Pure layout maths for the Square-1 scramble preview (no DOM, no
// sr-puzzlegen import) so the exact same code runs in the component and in
// a Node verification script. The caller supplies how to move a part,
// re-render, and measure a part's rendered bounds.

export type Square1Part = 'top' | 'middle' | 'bottom';

/** Axis-aligned bounds in SVG user units (y grows downward). */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface Square1LayoutHooks {
  /** Move a part's rotation centre to (x, y) in puzzle units. */
  place: (part: Square1Part, x: number, y: number) => void;
  /** Re-render the drawing with the current placements. */
  render: () => void;
  /** Rendered bounds of one part, in SVG units; null if it drew nothing. */
  measure: (part: Square1Part) => Box | null;
}

const PARTS: readonly Square1Part[] = ['top', 'middle', 'bottom'];

/** Gap between stacked parts, as a fraction of the middle slice's height
 *  (which, unlike the layers' heights, doesn't vary with the scramble). */
const GAP_RATIO = 0.45;

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

function measureAll(hooks: Square1LayoutHooks): Record<Square1Part, Box> | null {
  const top = hooks.measure('top');
  const middle = hooks.measure('middle');
  const bottom = hooks.measure('bottom');
  if (!top || !middle || !bottom) return null;
  return { top, middle, bottom };
}

/** Stacks top layer / middle slice / bottom layer on one vertical axis
 *  (all rotation centres at x = 0) with equal gaps between the parts' real
 *  rendered bounds for this scramble, then returns the bounds of the whole
 *  drawing. Returns null if anything failed to measure.
 *
 *  1. Render with every part at the origin and measure each part's extent
 *     around its own centre.
 *  2. Nudge every part by one puzzle unit and re-measure, giving each
 *     part's signed puzzle-unit → SVG-unit scale. The library's group scale
 *     and y direction are folded into it, and it's per part because the
 *     perspective camera scales the middle slice (drawn at z = -0.01)
 *     slightly differently from the layers.
 *  3. Place each part so its top edge sits one gap below the previous part's
 *     bottom edge, render, and measure the union. */
export function layoutSquare1(hooks: Square1LayoutHooks): Box | null {
  for (const part of PARTS) hooks.place(part, 0, 0);
  hooks.render();
  const rel = measureAll(hooks);
  if (!rel) return null;

  for (const part of PARTS) hooks.place(part, 0, 1);
  hooks.render();
  const probed = measureAll(hooks);
  if (!probed) return null;
  const scale = {} as Record<Square1Part, number>;
  for (const part of PARTS) {
    scale[part] = probed[part].minY - rel[part].minY;
    if (Math.abs(scale[part]) < 1e-9) return null;
  }

  const gap = GAP_RATIO * (rel.middle.maxY - rel.middle.minY);
  const yTop = 0;
  const yMiddle = yTop + rel.top.maxY + gap - rel.middle.minY;
  const yBottom = yMiddle + rel.middle.maxY + gap - rel.bottom.minY;

  hooks.place('top', 0, yTop / scale.top);
  hooks.place('middle', 0, yMiddle / scale.middle);
  hooks.place('bottom', 0, yBottom / scale.bottom);
  hooks.render();

  const final = measureAll(hooks);
  return final ? unionBoxes([final.top, final.middle, final.bottom]) : null;
}

/** viewBox around `box`, padded by `padRatio` of its larger side plus half
 *  the stroke width (polygon points exclude the stroke). */
export function paddedViewBox(box: Box, padRatio: number, strokeWidth: number): ViewBox {
  const pad = padRatio * Math.max(box.maxX - box.minX, box.maxY - box.minY) + strokeWidth / 2;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    width: box.maxX - box.minX + 2 * pad,
    height: box.maxY - box.minY + 2 * pad,
  };
}
