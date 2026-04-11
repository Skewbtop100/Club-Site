export interface Athlete {
  id: string;
  athleteId?: string;
  name: string;
  lastName?: string;
  wcaId?: string;
  birthDate?: string;
  imageUrl?: string;
}

export interface CompetitionAthlete {
  id: string;
  name: string;
  events: string[];
}

export interface EventConfig {
  rounds: number;
  groups: number;
}

export interface Competition {
  id: string;
  name: string;
  status: 'upcoming' | 'live' | 'finished';
  date?: string | { toDate: () => Date };
  clubDate?: string | { toDate: () => Date };
  country?: string;
  events?: Record<string, boolean>;
  athletes?: CompetitionAthlete[];
  eventConfig?: Record<string, EventConfig>;
}

export interface Result {
  id: string;
  status: string;
  source?: string;
  eventId: string;
  athleteId: string;
  athleteName?: string;
  competitionId: string;
  competitionName?: string;
  single: number | null;
  average: number | null;
  solves?: (number | null)[];
  round?: number;
  group?: number;
  country?: string;
  submittedAt?: unknown;
}

export interface WcaRecordEntry {
  value: number;
}

export interface WcaRecordType {
  WR?: WcaRecordEntry;
  CR?: WcaRecordEntry;
  NR?: WcaRecordEntry;
}

export interface WcaRecordDoc {
  single?: WcaRecordType;
  average?: WcaRecordType;
}

export type WcaRecords = Record<string, WcaRecordDoc>;
export type EventVisibility = Record<string, 'auto' | 'show' | 'hide'>;
