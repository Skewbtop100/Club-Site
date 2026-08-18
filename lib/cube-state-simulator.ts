// Pure 3x3x3 cube-state simulator: apply WCA-notation moves/scrambles to a
// sticker-level cube state. No UI, no camera, no external deps — used later
// to compare a camera-read face against the expected post-scramble state.
//
// ── Color scheme ─────────────────────────────────────────────────────────
// Standard WCA "BOY" scheme: white=U, yellow=D, green=F, blue=B, orange=L,
// red=R. Confirmed (not assumed) against this codebase's actual scramble
// dependency: rendering `cstimer_module`'s own getImage('', '333') (the
// solved-state SVG, same engine app/api/scramble/route.ts uses) and reading
// off the net layout — white sits above the green center square, yellow
// below it, and orange/green/red/blue run left-to-right — is exactly this
// scheme. Any camera-comparison code built on top of this module MUST use
// the same scheme or every comparison will be silently wrong.
//
// ── Geometry ──────────────────────────────────────────────────────────────
// Internally, each sticker is tracked as a rigid point+normal in cubie space
// (coords in {-1,0,1} per axis, x=+1↔R, y=+1↔U, z=+1↔F — a standard
// right-handed frame matching how a solver holds the cube: U up, F toward
// them, R to their right). A face turn is a 90° rotation of the matching
// axis-aligned layer; the six rotation matrices below were derived from the
// WCA "clockwise as viewed from that face" definition, not copied from a
// table, and cross-checked against the well-known R-turn cycle (see the
// comment on TEST 4 in the accompanying test script). Applying a move
// converts CubeState → a flat sticker list, rotates the stickers in the
// affected layer, then re-derives (face, row, col) for every sticker from
// its new position/normal to rebuild CubeState.

export type CubeColorName = 'white' | 'yellow' | 'red' | 'orange' | 'blue' | 'green';
export type FaceName = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';

export type Face3x3 = [
  [CubeColorName, CubeColorName, CubeColorName],
  [CubeColorName, CubeColorName, CubeColorName],
  [CubeColorName, CubeColorName, CubeColorName],
];

export interface CubeState {
  U: Face3x3;
  D: Face3x3;
  F: Face3x3;
  B: Face3x3;
  L: Face3x3;
  R: Face3x3;
}

const FACES: FaceName[] = ['U', 'D', 'F', 'B', 'L', 'R'];

// ── Color scheme (see header comment) ───────────────────────────────────────
const FACE_COLOR: Record<FaceName, CubeColorName> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  L: 'orange',
  R: 'red',
};

export function makeSolvedState(): CubeState {
  const face = (f: FaceName): Face3x3 => {
    const c = FACE_COLOR[f];
    return [
      [c, c, c],
      [c, c, c],
      [c, c, c],
    ];
  };
  return { U: face('U'), D: face('D'), F: face('F'), B: face('B'), L: face('L'), R: face('R') };
}

export const SOLVED_STATE: CubeState = makeSolvedState();

// ── Geometry (see header comment) ───────────────────────────────────────────

type Vec3 = readonly [number, number, number];

const FACE_NORMAL: Record<FaceName, Vec3> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  L: [-1, 0, 0],
  R: [1, 0, 0],
};

// Inverse of faceRowCol below: given (face, row, col), the cubie position of
// that sticker. Derived from each face's "screen" basis (screen_right,
// screen_up, screen_out=face normal) as a right-handed triple, matching the
// standard cube net (U above F, D below F, L–F–R–B left to right) — the same
// net cstimer_module's getImage() renders.
function facePosition(face: FaceName, row: number, col: number): Vec3 {
  switch (face) {
    case 'F':
      return [col - 1, 1 - row, 1];
    case 'U':
      return [col - 1, 1, row - 1];
    case 'D':
      return [col - 1, -1, 1 - row];
    case 'R':
      return [1, 1 - row, 1 - col];
    case 'L':
      return [-1, 1 - row, col - 1];
    case 'B':
      return [1 - col, 1 - row, -1];
  }
}

// Given a sticker's current position (on a face, i.e. one coordinate at the
// extreme matching that face's normal), the (row, col) it now occupies.
function faceRowCol(face: FaceName, pos: Vec3): { row: number; col: number } {
  const [x, y, z] = pos;
  switch (face) {
    case 'F':
      return { row: 1 - y, col: 1 + x };
    case 'U':
      return { row: 1 + z, col: 1 + x };
    case 'D':
      return { row: 1 - z, col: 1 + x };
    case 'R':
      return { row: 1 - y, col: 1 - z };
    case 'L':
      return { row: 1 - y, col: 1 + z };
    case 'B':
      return { row: 1 - y, col: 1 - x };
  }
}

function faceFromNormal(n: Vec3): FaceName {
  const found = FACES.find(
    (f) => FACE_NORMAL[f][0] === n[0] && FACE_NORMAL[f][1] === n[1] && FACE_NORMAL[f][2] === n[2]
  );
  if (!found) throw new Error(`cube-state-simulator: no face matches normal ${n.join(',')}`);
  return found;
}

interface Sticker {
  pos: Vec3;
  normal: Vec3;
  color: CubeColorName;
}

function stateToStickers(state: CubeState): Sticker[] {
  const stickers: Sticker[] = [];
  for (const face of FACES) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        stickers.push({
          pos: facePosition(face, row, col),
          normal: FACE_NORMAL[face],
          color: state[face][row][col],
        });
      }
    }
  }
  return stickers;
}

function stickersToState(stickers: Sticker[]): CubeState {
  const state = makeSolvedState(); // placeholder grids; every cell gets overwritten below
  for (const s of stickers) {
    const face = faceFromNormal(s.normal);
    const { row, col } = faceRowCol(face, s.pos);
    state[face][row][col] = s.color;
  }
  return state;
}

// One 90° rotation per base move, expressed as (x,y,z) -> (x',y',z'). Each
// keeps its own axis coordinate fixed (so re-applying it stays within the
// same layer), matching the WCA "clockwise as viewed from that face"
// definition:
//   R (x=+1 layer): (x,y,z) -> (x, z,-y)
//   L (x=-1 layer): (x,y,z) -> (x,-z, y)
//   U (y=+1 layer): (x,y,z) -> (-z, y, x)
//   D (y=-1 layer): (x,y,z) -> ( z, y,-x)
//   F (z=+1 layer): (x,y,z) -> ( y,-x, z)
//   B (z=-1 layer): (x,y,z) -> (-y, x, z)
interface MoveDef {
  axis: 0 | 1 | 2;
  layer: 1 | -1;
  rotate: (v: Vec3) => Vec3;
}

const MOVE_DEFS: Record<'U' | 'D' | 'F' | 'B' | 'L' | 'R', MoveDef> = {
  R: { axis: 0, layer: 1, rotate: ([x, y, z]) => [x, z, -y] },
  L: { axis: 0, layer: -1, rotate: ([x, y, z]) => [x, -z, y] },
  U: { axis: 1, layer: 1, rotate: ([x, y, z]) => [-z, y, x] },
  D: { axis: 1, layer: -1, rotate: ([x, y, z]) => [z, y, -x] },
  F: { axis: 2, layer: 1, rotate: ([x, y, z]) => [y, -x, z] },
  B: { axis: 2, layer: -1, rotate: ([x, y, z]) => [-y, x, z] },
};

const MOVE_TOKEN_RE = /^([UDFBLR])(2|')?$/;

/**
 * Applies a single WCA-notation move (e.g. "R", "U'", "F2") to a cube state
 * and returns a new state — the input is never mutated.
 */
export function applyMove(state: CubeState, move: string): CubeState {
  const match = MOVE_TOKEN_RE.exec(move.trim());
  if (!match) {
    throw new Error(`cube-state-simulator: invalid move "${move}"`);
  }
  const base = match[1] as 'U' | 'D' | 'F' | 'B' | 'L' | 'R';
  const suffix = match[2];
  const turns = suffix === '2' ? 2 : suffix === "'" ? 3 : 1; // ' = three quarter-turns = one CCW turn

  const def = MOVE_DEFS[base];
  let stickers = stateToStickers(state);

  for (let t = 0; t < turns; t++) {
    stickers = stickers.map((s) =>
      s.pos[def.axis] === def.layer ? { ...s, pos: def.rotate(s.pos), normal: def.rotate(s.normal) } : s
    );
  }

  return stickersToState(stickers);
}

/**
 * Parses a space-separated WCA scramble (e.g. "R U R' U' F2 L D2") and
 * applies each move in sequence, starting from the solved state.
 */
export function applyScramble(scramble: string): CubeState {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  return moves.reduce((state, move) => applyMove(state, move), makeSolvedState());
}

// ── Physical-validity invariants ────────────────────────────────────────────
// Opposite face pairs, derived from FACE_COLOR above (not hardcoded
// separately) so this always tracks whatever color scheme SOLVED_STATE
// actually uses.
const OPPOSITE_FACE: Record<FaceName, FaceName> = { U: 'D', D: 'U', F: 'B', B: 'F', L: 'R', R: 'L' };
const OPPOSITE_COLOR: Record<CubeColorName, CubeColorName> = FACES.reduce(
  (acc, face) => {
    acc[FACE_COLOR[face]] = FACE_COLOR[OPPOSITE_FACE[face]];
    return acc;
  },
  {} as Record<CubeColorName, CubeColorName>
);

/**
 * Checks a CubeState against two invariants that must hold on any physically
 * possible cube state, regardless of scramble:
 *  - each of the 6 colors appears exactly 9 times across all 54 stickers
 *    (catches stickers being duplicated or lost during permutation)
 *  - no single physical PIECE ever shows two mutually-opposite colors on its
 *    own stickers. This is NOT "a sticker resting on face X can never show
 *    X's opposite color" — that's false and does NOT hold on real cubes (a
 *    single F2 or R2 from solved routinely puts e.g. yellow non-center
 *    stickers on the U face; only face CENTERS are permanently tied to one
 *    color, since only centers never move). The real, permanent constraint
 *    is on PIECES: an edge (2 stickers) or corner (3 stickers) cubie only
 *    ever spans mutually ADJACENT faces by construction, and opposite faces
 *    are never adjacent, so no edge/corner can ever carry two opposite
 *    colors AT THE SAME TIME on its own stickers, no matter how it's been
 *    permuted. Stickers are grouped by their shared cubie position (not by
 *    which face they're currently resting on) to check this.
 * Returns a list of human-readable violation descriptions; empty = valid.
 */
export function validateStateInvariants(state: CubeState): string[] {
  const violations: string[] = [];
  const counts: Record<CubeColorName, number> = {
    white: 0,
    yellow: 0,
    red: 0,
    orange: 0,
    blue: 0,
    green: 0,
  };

  const stickers = stateToStickers(state);
  stickers.forEach((s) => counts[s.color]++);

  (Object.keys(counts) as CubeColorName[]).forEach((color) => {
    if (counts[color] !== 9) {
      violations.push(`color '${color}' appears ${counts[color]} times across the state, expected exactly 9`);
    }
  });

  const byPosition = new Map<string, Sticker[]>();
  stickers.forEach((s) => {
    const key = s.pos.join(',');
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key)!.push(s);
  });

  byPosition.forEach((group, posKey) => {
    if (group.length < 2) return; // face-center sticker, nothing to conflict with
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (OPPOSITE_COLOR[a.color] === b.color) {
          violations.push(
            `cubie at position (${posKey}) shows both '${a.color}' and '${b.color}' on its own stickers — these are opposite colors and can never share a single edge/corner piece`
          );
        }
      }
    }
  });

  return violations;
}
