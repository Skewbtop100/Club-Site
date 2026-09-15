// ── Deleting a competition, and everything that belongs to it ───────────
// Server-only (firebase-admin). Driven by
// app/api/online-competition/admin-competitions/[id]/delete, and run for
// real against the emulator in tests/competition-fields/competition-delete.
//
// ── WHAT A COMPETITION OWNS ──
// Under onlineCompetitions/{id}: the document (poster, banner and section
// image ids) and the subcollections roundState, runTickets, qualifiers,
// scrambleData, groupAssignments and the legacy scrambles.
// NOT under it — orphaned by deleting the document alone:
//   onlineParticipants/{uid}/registrations/{id}   every registration
//   onlineSubmissions (competitionId == id)       every attempt, and through
//                                                 them the R2 videos, legacy
//                                                 Cloudinary videos and stills
//   R2 videos/{uid}/{id}/…                        uploads never filed
//   Cloudinary poster / banner / section images
//   onlineNotifications (competitionId == id)     only those written since
//                                                 the field existed — older
//                                                 ones carry no competition
//                                                 id and cannot be matched
//
// ── HIDE FIRST, THEN CLEAN UP ──
// startCompetitionDeletion checks the typed name and, in ONE transaction,
// moves the competition to 'draft' (which every public surface already
// hides: firestore.rules denies it, fetchAllCompetitions filters it, the
// roster and live routes 404 on it) with a `deletion` marker, and creates
// the deletion record. From that moment a half-finished delete is invisible
// to athletes. Round state and run tickets go first, so no scramble can be
// served and no attempt can be filed into it. The competition document is
// deleted LAST, only once nothing outside it still points at it.
//
// ── IN STEPS ──
// Thousands of submissions each need a video delete — minutes, not the one
// minute a serverless request gets. runCompetitionDeletionStep does as much
// as fits in a time budget, records where it got to, and returns; the admin
// screen calls it again until it reports done. Every phase is re-runnable,
// and a lease stops two tabs working the same deletion at once.
//
// ── THE RECORD ──
// onlineCompetitionDeletions/{id} survives the competition: its name, who
// started the deletion (the admin session — the admin is a shared password,
// so not a person), when, what was removed, and every file that could not
// be. Denied to every client by firestore.rules.

import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { VIDEO_KEY_PREFIX, r2Bucket, r2Client } from './r2-video';
import {
  deleteSubmissionAndVideo,
  destroyCloudinaryImages,
  type ImageDestroyResult,
  type R2CleanupDeps,
} from './submission-cleanup';
import { normalizeRegistrationStatus } from './registration-shape';
import { ONLINE_NOTIFICATIONS } from './types';

export const COMPETITION_DELETIONS = 'onlineCompetitionDeletions';

/** Subcollections of the competition document, in the order they go. */
const ACTIVITY_SUBCOLLECTIONS = ['roundState', 'runTickets'] as const;
const OTHER_SUBCOLLECTIONS = ['qualifiers', 'scrambleData', 'groupAssignments', 'scrambles'] as const;
const ALL_SUBCOLLECTIONS = [...ACTIVITY_SUBCOLLECTIONS, ...OTHER_SUBCOLLECTIONS];

const FAILURES_KEPT = 200;
const REFUSED_KEPT = 100;
const WRITE_BATCH = 400;

export class CompetitionDeleteError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CompetitionDeleteError';
    this.status = status;
  }
}

export type DeletionPhase =
  | 'rounds'
  | 'submissions'
  | 'registrations'
  | 'notifications'
  | 'subcollections'
  | 'images'
  | 'r2-orphans'
  | 'finalize'
  | 'done';

export const DELETION_PHASES: DeletionPhase[] = [
  'rounds',
  'submissions',
  'registrations',
  'notifications',
  'subcollections',
  'images',
  'r2-orphans',
  'finalize',
  'done',
];

export interface DeletionPreview {
  competitionId: string;
  name: string;
  /** What the admin must type — the name, or the id for an unnamed one. */
  confirmText: string;
  status: string;
  registrations: { total: number; approved: number; pending: number; other: number };
  submissions: { total: number; judged: number; pending: number };
  videos: { r2: number; legacyCloudinary: number; stills: number };
  /** Notifications that carry this competition's id. */
  notifications: number;
  /** Documents in each subcollection of the competition. */
  roundDocs: Record<string, number>;
  images: number;
}

export interface DeletionCounters {
  submissions: number;
  r2Videos: number;
  legacyVideos: number;
  stills: number;
  registrations: number;
  notifications: number;
  roundDocs: number;
  images: number;
  r2Orphans: number;
}

export interface DeletionFailure {
  kind: 'r2-video' | 'legacy-video' | 'still' | 'image' | 'r2-orphan' | 'r2-scan' | 'submission';
  id: string;
  detail: string;
}

export interface DeletionJob {
  competitionId: string;
  name: string;
  statusBefore: string;
  requestedBy: { sessionId: string | null; ip: string | null; userAgent: string | null };
  startedAtMs: number;
  completedAtMs: number | null;
  phase: DeletionPhase;
  preview: DeletionPreview;
  imageIds: string[];
  r2Cursor: string | null;
  removed: DeletionCounters;
  failureCount: number;
  failures: DeletionFailure[];
  refusedCount: number;
  refused: { kind: string; id: string; reason: string }[];
  leaseUntilMs: number | null;
}

/** What the admin screen is sent — the record without its internals. */
export interface DeletionJobView {
  competitionId: string;
  name: string;
  phase: DeletionPhase;
  done: boolean;
  startedAtMs: number;
  completedAtMs: number | null;
  preview: DeletionPreview;
  removed: DeletionCounters;
  failureCount: number;
  failures: DeletionFailure[];
  refusedCount: number;
  refused: { kind: string; id: string; reason: string }[];
}

export function toDeletionJobView(job: DeletionJob): DeletionJobView {
  return {
    competitionId: job.competitionId,
    name: job.name,
    phase: job.phase,
    done: job.phase === 'done',
    startedAtMs: job.startedAtMs,
    completedAtMs: job.completedAtMs,
    preview: job.preview,
    removed: job.removed,
    failureCount: job.failureCount,
    failures: job.failures,
    refusedCount: job.refusedCount,
    refused: job.refused,
  };
}

// ── what belongs to it ─────────────────────────────────────────────────────

/** Every Cloudinary image id the competition document names. */
export function competitionImageIds(data: Record<string, unknown> | undefined): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.add(v.trim());
  };
  add(data?.posterPublicId);
  add(data?.bannerPublicId);
  const sections = Array.isArray(data?.sections) ? (data?.sections as unknown[]) : [];
  for (const s of sections) {
    const blocks = Array.isArray((s as { blocks?: unknown })?.blocks) ? ((s as { blocks: unknown[] }).blocks) : [];
    for (const b of blocks) add((b as { imagePublicId?: unknown })?.imagePublicId);
  }
  return [...ids];
}

/** This competition's registration documents. The unfiltered collection-group
 *  read every other caller uses (a filtered one needs an index this project
 *  does not have), with the same guard against the club site's unrelated
 *  top-level `registrations` collection. */
async function registrationDocsFor(db: Firestore, competitionId: string): Promise<QueryDocumentSnapshot[]> {
  const snap = await db.collectionGroup('registrations').get();
  return snap.docs.filter(
    (d) =>
      d.ref.parent.parent?.parent.id === 'onlineParticipants' &&
      (d.id === competitionId || d.get('competitionId') === competitionId),
  );
}

// ── preview ────────────────────────────────────────────────────────────────

/** Counts what a deletion would remove. Reads only. */
export async function previewCompetitionDeletion(db: Firestore, competitionId: string): Promise<DeletionPreview> {
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const snap = await compRef.get();
  if (!snap.exists) throw new CompetitionDeleteError('Тэмцээн олдсонгүй.', 404);
  const data = snap.data() ?? {};

  const [regs, subs, notifications, ...subCounts] = await Promise.all([
    registrationDocsFor(db, competitionId),
    db
      .collection('onlineSubmissions')
      .where('competitionId', '==', competitionId)
      .select('status', 'videoKey', 'cloudinaryPublicId', 'timerShotIds', 'cubeShotIds')
      .get(),
    db.collection(ONLINE_NOTIFICATIONS).where('competitionId', '==', competitionId).count().get(),
    ...ALL_SUBCOLLECTIONS.map((c) => compRef.collection(c).count().get()),
  ]);

  const registrations = { total: regs.length, approved: 0, pending: 0, other: 0 };
  for (const r of regs) {
    const s = normalizeRegistrationStatus(r.get('status'));
    if (s === 'approved') registrations.approved += 1;
    else if (s === 'pending') registrations.pending += 1;
    else registrations.other += 1;
  }

  const submissions = { total: subs.size, judged: 0, pending: 0 };
  const videos = { r2: 0, legacyCloudinary: 0, stills: 0 };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).length : 0);
  for (const d of subs.docs) {
    const status = d.get('status');
    if (status === 'approved' || status === 'rejected') submissions.judged += 1;
    else submissions.pending += 1;
    if (typeof d.get('videoKey') === 'string' && d.get('videoKey')) videos.r2 += 1;
    if (typeof d.get('cloudinaryPublicId') === 'string' && d.get('cloudinaryPublicId')) videos.legacyCloudinary += 1;
    videos.stills += strings(d.get('timerShotIds')) + strings(d.get('cubeShotIds'));
  }

  const roundDocs: Record<string, number> = {};
  ALL_SUBCOLLECTIONS.forEach((c, i) => {
    roundDocs[c] = subCounts[i].data().count;
  });

  const name = typeof data.name === 'string' ? data.name : '';
  return {
    competitionId,
    name,
    confirmText: name || competitionId,
    status: typeof data.status === 'string' ? data.status : '',
    registrations,
    submissions,
    videos,
    notifications: notifications.data().count,
    roundDocs,
    images: competitionImageIds(data).length,
  };
}

// ── start ──────────────────────────────────────────────────────────────────

const ZERO: DeletionCounters = {
  submissions: 0,
  r2Videos: 0,
  legacyVideos: 0,
  stills: 0,
  registrations: 0,
  notifications: 0,
  roundDocs: 0,
  images: 0,
  r2Orphans: 0,
};

export async function getCompetitionDeletion(db: Firestore, competitionId: string): Promise<DeletionJob | null> {
  const snap = await db.collection(COMPETITION_DELETIONS).doc(competitionId).get();
  return snap.exists ? (snap.data() as DeletionJob) : null;
}

/** Checks the typed name and hides the competition, creating the deletion
 *  record — both in one transaction. A wrong or partial name writes
 *  nothing. A deletion already under way is returned as it stands. */
export async function startCompetitionDeletion(
  db: Firestore,
  competitionId: string,
  input: {
    confirmName: unknown;
    requestedBy: DeletionJob['requestedBy'];
    nowMs?: number;
  },
): Promise<DeletionJob> {
  const nowMs = input.nowMs ?? Date.now();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const jobRef = db.collection(COMPETITION_DELETIONS).doc(competitionId);

  const existing = await jobRef.get();
  if (existing.exists && existing.get('phase') !== 'done') return existing.data() as DeletionJob;

  const preview = await previewCompetitionDeletion(db, competitionId);
  if (typeof input.confirmName !== 'string' || input.confirmName !== preview.confirmText) {
    throw new CompetitionDeleteError('Тэмцээний нэр таарахгүй байна. Нэрийг яг адилхан бичнэ үү.', 400);
  }

  let job: DeletionJob | null = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(compRef);
    if (!snap.exists) throw new CompetitionDeleteError('Тэмцээн олдсонгүй.', 404);
    const data = snap.data() ?? {};
    // Renamed between the preview and now: the admin confirmed a name that
    // is no longer this competition's.
    const confirmText = (typeof data.name === 'string' && data.name) || competitionId;
    if (input.confirmName !== confirmText) {
      throw new CompetitionDeleteError('Тэмцээний нэр таарахгүй байна. Нэрийг яг адилхан бичнэ үү.', 400);
    }
    const statusBefore = typeof data.status === 'string' ? data.status : '';
    job = {
      competitionId,
      name: typeof data.name === 'string' ? data.name : '',
      statusBefore,
      requestedBy: input.requestedBy,
      startedAtMs: nowMs,
      completedAtMs: null,
      phase: 'rounds',
      preview,
      imageIds: competitionImageIds(data),
      r2Cursor: null,
      removed: { ...ZERO },
      failureCount: 0,
      failures: [],
      refusedCount: 0,
      refused: [],
      leaseUntilMs: null,
    };
    // HIDDEN FROM THIS MOMENT. 'draft' is the one status every public
    // surface already refuses to show; `featured` goes so no banner slot
    // keeps pointing at it.
    tx.update(compRef, {
      status: 'draft',
      featured: false,
      deletion: { startedAtMs: nowMs, statusBefore },
    });
    tx.set(jobRef, job);
  });
  return job!;
}

// ── steps ──────────────────────────────────────────────────────────────────

export interface DeletionStepDeps {
  r2?: R2CleanupDeps;
  destroyImages?: (publicIds: string[]) => Promise<ImageDestroyResult>;
  /** How long one call may work before saving and returning. */
  budgetMs?: number;
  /** Submissions per unit of work. */
  batchSize?: number;
  now?: () => number;
}

function addFailure(job: DeletionJob, failure: DeletionFailure) {
  const same = job.failures.find((f) => f.kind === failure.kind && f.id === failure.id);
  if (same) {
    same.detail = failure.detail;
    return;
  }
  job.failureCount += 1;
  if (job.failures.length < FAILURES_KEPT) job.failures.push(failure);
}

function clearFailure(job: DeletionJob, kind: DeletionFailure['kind'], id: string): boolean {
  const i = job.failures.findIndex((f) => f.kind === kind && f.id === id);
  if (i === -1) return false;
  job.failures.splice(i, 1);
  job.failureCount = Math.max(0, job.failureCount - 1);
  return true;
}

async function deleteDocs(db: Firestore, docs: QueryDocumentSnapshot[]): Promise<number> {
  for (let i = 0; i < docs.length; i += WRITE_BATCH) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + WRITE_BATCH)) batch.delete(d.ref);
    await batch.commit();
  }
  return docs.length;
}

/** One unit of work. Returns the phase to be in afterwards: the same phase
 *  while it has more to do, the next one when it is finished. */
async function runUnit(db: Firestore, job: DeletionJob, deps: DeletionStepDeps): Promise<DeletionPhase> {
  const id = job.competitionId;
  const compRef = db.collection('onlineCompetitions').doc(id);

  switch (job.phase) {
    // Round state and run tickets FIRST: with no live round no scramble is
    // served, and with no ticket no attempt can be filed.
    case 'rounds': {
      for (const sub of ACTIVITY_SUBCOLLECTIONS) {
        const snap = await compRef.collection(sub).limit(WRITE_BATCH).get();
        if (!snap.empty) {
          job.removed.roundDocs += await deleteDocs(db, snap.docs);
          return 'rounds';
        }
      }
      return 'submissions';
    }

    // Through deleteSubmissionAndVideo, never a bare document delete: it
    // knows each video kind, removes the stills, refuses files that are not
    // provably the submission's own — and deletes the document even when a
    // file cannot be removed, reporting it instead.
    case 'submissions': {
      const snap = await db
        .collection('onlineSubmissions')
        .where('competitionId', '==', id)
        .limit(deps.batchSize ?? 50)
        .get();
      if (snap.empty) return 'registrations';

      let docFailures = 0;
      const queue = [...snap.docs];
      const worker = async () => {
        for (let doc = queue.shift(); doc; doc = queue.shift()) {
          const data = doc.data();
          try {
            const result = await deleteSubmissionAndVideo(doc.ref, data, 'competition delete', { r2: deps.r2 });
            job.removed.submissions += 1;
            if (typeof data.videoKey === 'string' && data.videoKey) {
              if (result.r2Deleted) job.removed.r2Videos += 1;
              else if (!result.r2Detail.startsWith('refused')) {
                addFailure(job, { kind: 'r2-video', id: data.videoKey, detail: result.r2Detail });
              }
            }
            if (typeof data.cloudinaryPublicId === 'string' && data.cloudinaryPublicId) {
              if (result.cloudinaryDeleted) job.removed.legacyVideos += 1;
              else if (!result.cloudinaryDetail.startsWith('refused')) {
                addFailure(job, { kind: 'legacy-video', id: data.cloudinaryPublicId, detail: result.cloudinaryDetail });
              }
            }
            job.removed.stills += result.stillsDeleted;
            if (result.stillsFailed > 0) {
              addFailure(job, { kind: 'still', id: doc.id, detail: `${result.stillsFailed} зураг устгагдсангүй` });
            }
            for (const r of result.refused) {
              job.refusedCount += 1;
              if (job.refused.length < REFUSED_KEPT) job.refused.push({ kind: r.kind, id: r.id, reason: r.reason });
            }
          } catch (err) {
            docFailures += 1;
            addFailure(job, { kind: 'submission', id: doc.id, detail: (err as Error)?.message ?? 'unknown' });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, snap.size) }, worker));
      // Not one document went: a retry of this query would return the same
      // batch forever. Stop and let the admin try again later.
      if (docFailures === snap.size) {
        throw new CompetitionDeleteError('Илгээмжийн баримтуудыг устгаж чадсангүй. Дахин оролдоно уу.', 500);
      }
      return 'submissions';
    }

    case 'registrations': {
      const docs = await registrationDocsFor(db, id);
      if (docs.length === 0) return 'notifications';
      job.removed.registrations += await deleteDocs(db, docs.slice(0, WRITE_BATCH));
      return 'registrations';
    }

    case 'notifications': {
      const snap = await db.collection(ONLINE_NOTIFICATIONS).where('competitionId', '==', id).limit(WRITE_BATCH).get();
      if (snap.empty) return 'subcollections';
      job.removed.notifications += await deleteDocs(db, snap.docs);
      return 'notifications';
    }

    // Every remaining subcollection — the named ones, and anything written
    // meanwhile (a cut committed during the delete recreates a document).
    case 'subcollections': {
      for (const col of await compRef.listCollections()) {
        const snap = await col.limit(WRITE_BATCH).get();
        if (!snap.empty) {
          job.removed.roundDocs += await deleteDocs(db, snap.docs);
          return 'subcollections';
        }
      }
      return 'images';
    }

    // The competition's own images. One that ANOTHER competition also names
    // is not deleted — it is that competition's image too.
    case 'images': {
      if (job.imageIds.length === 0) return 'r2-orphans';
      const others = await db.collection('onlineCompetitions').get();
      const elsewhere = new Set<string>();
      for (const d of others.docs) {
        if (d.id === id) continue;
        for (const img of competitionImageIds(d.data())) elsewhere.add(img);
      }
      const allowed = job.imageIds.filter((img) => !elsewhere.has(img));
      for (const img of job.imageIds.filter((i) => elsewhere.has(i))) {
        job.refusedCount += 1;
        if (job.refused.length < REFUSED_KEPT) {
          job.refused.push({ kind: 'image', id: img, reason: 'өөр тэмцээн энэ зургийг ашиглаж байна' });
        }
      }
      if (allowed.length > 0) {
        const result = await (deps.destroyImages ?? destroyCloudinaryImages)(allowed);
        job.removed.images += result.deleted;
        for (const f of result.failures) addFailure(job, { kind: 'image', id: f.publicId, detail: f.detail });
      }
      job.imageIds = [];
      return 'r2-orphans';
    }

    // Videos stored under this competition that no submission names any
    // more: uploads that were never filed, and any a submission's own
    // delete could not remove (retried here). R2 keys are
    // videos/{uid}/{competitionId}/…, so the competition is the THIRD
    // segment and has to be found by scanning.
    case 'r2-orphans': {
      let client: S3Client;
      let bucket: string;
      try {
        client = deps.r2?.client ?? r2Client();
        bucket = deps.r2?.bucket ?? r2Bucket();
      } catch {
        addFailure(job, { kind: 'r2-scan', id: `${VIDEO_KEY_PREFIX}/`, detail: 'R2 тохируулаагүй — хадгалагдсан бичлэг шалгагдсангүй' });
        return 'finalize';
      }
      let listed;
      try {
        listed = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `${VIDEO_KEY_PREFIX}/`,
            ContinuationToken: job.r2Cursor ?? undefined,
            MaxKeys: 1000,
          }),
        );
      } catch (err) {
        addFailure(job, { kind: 'r2-scan', id: `${VIDEO_KEY_PREFIX}/`, detail: (err as Error)?.message ?? 'list failed' });
        return 'finalize';
      }
      for (const obj of listed.Contents ?? []) {
        const key = obj.Key;
        if (!key || key.split('/')[2] !== id) continue;
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          // A submission's video that failed earlier and went through now.
          if (clearFailure(job, 'r2-video', key)) job.removed.r2Videos += 1;
          else job.removed.r2Orphans += 1;
        } catch (err) {
          if (!job.failures.some((f) => f.kind === 'r2-video' && f.id === key)) {
            addFailure(job, { kind: 'r2-orphan', id: key, detail: (err as Error)?.message ?? 'delete failed' });
          }
        }
      }
      job.r2Cursor = listed.IsTruncated ? (listed.NextContinuationToken ?? null) : null;
      return listed.IsTruncated && job.r2Cursor ? 'r2-orphans' : 'finalize';
    }

    // Only once nothing outside the document still points at it. Anything
    // written meanwhile sends the deletion round again.
    case 'finalize': {
      const [subs, regs, notes] = await Promise.all([
        db.collection('onlineSubmissions').where('competitionId', '==', id).limit(1).get(),
        registrationDocsFor(db, id),
        db.collection(ONLINE_NOTIFICATIONS).where('competitionId', '==', id).limit(1).get(),
      ]);
      if (!subs.empty || regs.length > 0 || !notes.empty) return 'submissions';
      await db.recursiveDelete(compRef);
      job.completedAtMs = (deps.now ?? Date.now)();
      return 'done';
    }

    case 'done':
      return 'done';
  }
}

/** Works the deletion until it is finished or the time budget is spent,
 *  saving progress after every unit. Always does at least one unit. */
export async function runCompetitionDeletionStep(
  db: Firestore,
  competitionId: string,
  deps: DeletionStepDeps = {},
): Promise<DeletionJob> {
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? 40_000;
  const started = now();
  const jobRef = db.collection(COMPETITION_DELETIONS).doc(competitionId);

  let job = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new CompetitionDeleteError('Устгал эхлээгүй байна.', 404);
    const current = snap.data() as DeletionJob;
    if (current.phase === 'done') return current;
    if (current.leaseUntilMs !== null && current.leaseUntilMs > now()) {
      throw new CompetitionDeleteError('Энэ устгал өөр цонхонд явагдаж байна. Түр хүлээгээд дахин оролдоно уу.', 409);
    }
    const leaseUntilMs = now() + budgetMs + 30_000;
    tx.update(jobRef, { leaseUntilMs });
    return { ...current, leaseUntilMs };
  });
  if (job.phase === 'done') return job;

  try {
    do {
      job.phase = await runUnit(db, job, deps);
      await jobRef.set({ ...job, leaseUntilMs: job.leaseUntilMs });
    } while (job.phase !== 'done' && now() - started < budgetMs);
  } finally {
    job = { ...job, leaseUntilMs: null };
    await jobRef.set(job);
  }
  return job;
}
