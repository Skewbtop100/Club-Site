// Client-side calls to the official WCA API for record HOLDERS (the admin's
// WCA Records tab). The API allows any origin, same as the /records endpoint
// that tab already calls for the values. See lib/wca-record-holders.ts for
// what is done with the answers.
import {
  pickRecordHolders, competitionIdsOf,
  type WcaApiRecordRow, type WcaHolderMap,
} from '@/lib/wca-record-holders';

const API = 'https://api.worldcubeassociation.org';
/** Record level → the API's region id (world, a continent id, a country's ISO2). */
const REGION = { WR: 'world', CR: '_Asia', NR: 'MN' } as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WCA API ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

/** Start dates of the given competitions, a few requests at a time. A
 *  competition that can't be fetched is just left out (its records then have
 *  a holder but no date). */
async function fetchCompetitionDates(ids: string[]): Promise<Record<string, string>> {
  const dates: Record<string, string> = {};
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const comp = await getJson<{ start_date?: string }>(`${API}/competitions/${encodeURIComponent(id)}`);
        if (comp.start_date) dates[id] = comp.start_date;
      } catch { /* leave undated */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return dates;
}

/**
 * Holders of the world, Asian and Mongolian records for the given events:
 * three record lists, then one request per distinct competition for its
 * date (a few dozen). Only run from the admin's "refresh records" button.
 */
export async function fetchWcaRecordHolders(events: Set<string>): Promise<Record<'WR' | 'CR' | 'NR', WcaHolderMap>> {
  const levels = ['WR', 'CR', 'NR'] as const;
  const lists = await Promise.all(levels.map(level =>
    getJson<{ records?: Record<string, WcaApiRecordRow[]> }>(`${API}/results/records?region=${REGION[level]}`),
  ));
  const ids = new Set<string>();
  lists.forEach(list => competitionIdsOf(list.records || {}, events).forEach(id => ids.add(id)));
  const dates = await fetchCompetitionDates([...ids]);
  return {
    WR: pickRecordHolders(lists[0].records || {}, dates, events),
    CR: pickRecordHolders(lists[1].records || {}, dates, events),
    NR: pickRecordHolders(lists[2].records || {}, dates, events),
  };
}
