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

export interface AdvancementConfig {
  type: 'fixed' | 'percent';
  value: number;
}

export interface EventConfig {
  rounds: number;
  groups: number;
  advancement?: Record<string, AdvancementConfig>;
}

export interface Competition {
  id: string;
  name: string;
  status: 'upcoming' | 'live' | 'finished';
  date?: string | { toDate: () => Date };
  clubDate?: string | { toDate: () => Date };
  country?: string;
  imageUrl?: string;
  events?: Record<string, boolean>;
  athletes?: CompetitionAthlete[];
  eventConfig?: Record<string, EventConfig>;
  roundStatus?: Record<string, 'complete' | 'ongoing'>;
  finishedAt?: { toDate: () => Date } | string | number;
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
  /** True when this is an auto-created next-round placeholder awaiting solves. */
  isPlaceholder?: boolean;
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
