export interface WcaEvent {
  id: string;
  name: string;
  short: string;
}

export const WCA_EVENTS: WcaEvent[] = [
  { id: '333',    name: '3x3x3',              short: '3x3'  },
  { id: '222',    name: '2x2x2',              short: '2x2'  },
  { id: '444',    name: '4x4x4',              short: '4x4'  },
  { id: '555',    name: '5x5x5',              short: '5x5'  },
  { id: '666',    name: '6x6x6',              short: '6x6'  },
  { id: '777',    name: '7x7x7',              short: '7x7'  },
  { id: '333bf',  name: '3x3x3 Blindfolded',  short: '3BLD' },
  { id: '333fm',  name: '3x3x3 Fewest Moves', short: 'FMC'  },
  { id: '333oh',  name: '3x3x3 One-Handed',   short: '3OH'  },
  { id: 'clock',  name: 'Clock',              short: 'CLK'  },
  { id: 'minx',   name: 'Megaminx',           short: 'MINX' },
  { id: 'pyram',  name: 'Pyraminx',           short: 'PYRA' },
  { id: 'skewb',  name: 'Skewb',              short: 'SKWB' },
  { id: 'sq1',    name: 'Square-1',           short: 'SQ-1' },
  { id: '444bf',  name: '4x4x4 Blindfolded',  short: '4BLD' },
  { id: '555bf',  name: '5x5x5 Blindfolded',  short: '5BLD' },
  { id: '333mbf', name: '3x3x3 Multi-Blind',  short: 'MBLD' },
];

export function getEvent(id: string): WcaEvent | undefined {
  return WCA_EVENTS.find((e) => e.id === id);
}
