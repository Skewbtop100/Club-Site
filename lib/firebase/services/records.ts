import {
  getDocs,
  getDoc,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';
import { wcaRecordsCol, eventVisibilityDoc } from '@/lib/firebase/collections';
import type { WcaRecords, EventVisibility } from '@/lib/types';

// ── WCA Records ──────────────────────────────────────────────────────────────

/** Real-time subscription to WCA records. Returns unsubscribe function. */
export function subscribeWcaRecords(
  onData: (records: WcaRecords) => void,
  onError?: () => void,
): () => void {
  return onSnapshot(
    wcaRecordsCol,
    (snap) => {
      const data: WcaRecords = {};
      snap.docs.forEach((d) => { data[d.id] = d.data() as WcaRecords[string]; });
      onData(data);
    },
    () => onError?.(),
  );
}

// ── Event Visibility ─────────────────────────────────────────────────────────
//
// IMPORTANT: The canonical path is settings/eventVisibility.
// EventSettingsTab previously wrote to config/eventVisibility (wrong path).
// All reads and writes must go through this service to stay consistent.

/** Real-time subscription to event visibility settings. Returns unsubscribe function. */
export function subscribeEventVisibility(
  onData: (visibility: EventVisibility) => void,
  onError?: () => void,
): () => void {
  return onSnapshot(
    eventVisibilityDoc,
    (snap) => onData(snap.exists() ? (snap.data() as EventVisibility) : {}),
    () => onError?.(),
  );
}

/** One-time fetch of event visibility settings. */
export async function getEventVisibility(): Promise<EventVisibility> {
  const snap = await getDoc(eventVisibilityDoc);
  return snap.exists() ? (snap.data() as EventVisibility) : {};
}

/** Persist event visibility settings (overwrites the document). */
export async function saveEventVisibility(settings: EventVisibility): Promise<void> {
  await setDoc(eventVisibilityDoc, settings);
}
