# Coach Challenge system — plan

Status: **planning only**. Nothing in this document has been built. No code, rules or data were changed while writing it.

Scope: the timer at `mongolshoochid.com/timer` (this repo, `app/timer/`).

Revision: updated with the **Owner decisions (2026-10-16)** below. Every open question from the first draft (1–24) and the follow-up questions (N1–N7) are answered there, and Parts A and B have been changed to match. **No open questions remain.**

---

## Owner decisions (2026-10-16)

Rows 1–24 close the questions with the same number in the first draft's B8. Rows N1–N7 close the follow-up questions raised by the second draft.

| # | Question | Decision | Plan sections changed |
|---|---|---|---|
| 1 | Fake times / trust level | An in-person coach plus **server sanity checks** is enough. The checks are impossible times per event and solves too close together. | A7, B3, B4 |
| 2 | Coach storage and roles | Separate `coaches/{uid}` list granted by the admin. **Admins are coaches automatically.** A coach can be a student in another coach's room. | A1, B1, B3 |
| 3 | Bluetooth smart timers | **Keyboard/touch timer only** in phase 1. Bluetooth smart timers are **not** allowed during challenges (maybe later). | A7, B2, B4 |
| 4 | +2 / DNF window | After **every** challenge solve the student must **confirm OK / +2 / DNF** before it counts. Once confirmed it **cannot be changed**. Completion is evaluated only on confirmed solves. | A7, A8, B3, B4 |
| 5 | Unfinished block at session end | **Discarded**; it does not count, not even as an attempted block. | A4, B4 |
| 6 | Target precision | Compared on the **displayed time** (truncated to centiseconds), **strictly less** than the target. 2.00 does **not** pass "< 2.00". | A4, B4 |
| 7 | Allowed values | Metric is one of **Single, Mo3, Ao5, Ao12, Ao25, Ao50, Ao100**. M ("times in a row") is any whole number **≥ 1** typed by the coach, with a hard max of **100** as typo protection. | A3, B2, B3 |
| 8 | "Only ONE active" | **One running session at a time.** A student may be pursuing several challenges. | A5, B3 |
| 9 | Editing after assigning | **Editable until first started**, then locked. To change it, the coach **duplicates** it. | A5, B2, B3 |
| 10 | Removed student | Their history and completed challenges are **kept**, and become **visible again if re-added**. | A2, B2, B3 |
| 11 | Normal stats and points | Challenge solves go to a **separate "Challenge" timer session**. They earn **no club points** and don't affect normal session stats. | A7, B4 |
| 12 | Event during a challenge | **Locked** to the challenge's event. | A7, B4 |
| 13 | Coach live view | **Yes**, the coach gets a live view. | B2 (read estimate) |
| 14 | "Days taken" | **Calendar days in UB time** from the first start date to the completion date. | A8, B4 (exact count: N1) |
| 15 | Second session the same day | **Allowed.** The coach may start another session the same day. | A6, B3 |
| 16 | Student offline at start | When pressing **"Эхлүүлэх"** the coach sets an **end time** (e.g. 18:00, class end), and the session auto-closes then. The default is **midnight UB**. If the student is offline it activates when they open the timer, until that end time. | A6, B2, B3, B5 |
| 17 | Reward | **✅ plus a celebration screen** only for now; points or rewards later. | A8, B4 |
| 18 | Rooms per student | A student can be in **several rooms**. | A2 |
| 19 | Room codes | **6 characters**, no confusable characters (no O/0, I/1/L). The coach can **regenerate** it. | A1, B2, B3 |
| 20 | Scheduler | A **daily Vercel cron** for cleanup is OK. End times are **also enforced lazily** on every read or action. | B3, B4 |
| 21 | Progress strip placement | The strip (e.g. **●●○○○ 2/5**) sits **just above the timer digits**. | A9, B4 |
| 22 | Inspection | **Off** during challenges, with no per-challenge toggle. | A7, B4 |
| 23 | Shared scramble | **"Ижил холилт" is disabled** during a challenge; scrambles are random. | A7, B4 |
| 24 | Privacy | A student's name and photo are visible **only to coaches of rooms they belong to**. | B3 |
| N1 | Days taken, exact count | Started and completed **the same day = 1 day** (inclusive count of UB calendar days). | A8, B3, B4, B6 |
| N2 | End time limits | The coach's end time must be on the **same UB day (latest 23:59)** and **at least 10 minutes from now**. | A6, B2, B3, B6 |
| N3 | Unconfirmed solve at end time | **Dropped**: a solve not yet confirmed (OK / +2 / DNF) when the end time arrives never counts. | A7, B4, B6 |
| N4 | Removed student's own view | A removed student **still sees their own history**; only the **coach's** view is hidden (until re-add). | A2, B3 |
| N5 | Sanity-check floors | Per-event minimums **slightly below each world-record single** are confirmed. A refused solve shows the student **"Цаг хэт хурдан байна"**. | A7, B3, B6 |
| N6 | Strip while timing | The progress strip **fades out while timing** like the rest of the UI, and **returns when the timer stops**. | A9, B4 |
| N7 | Comments on challenge solves | **Allowed.** | A7, B4 |

---

## PART A — Бүтээгдэхүүний дүрэм (product rules, decided by the owner)

### A1. Өрөө (Room)
- Зөвхөн клубын админаас **coach** эрх авсан хэрэглэгч өрөө (room) үүсгэнэ. **Админ автоматаар coach** байна.
- Нэг coach олон өрөөтэй байж болно.
- Өрөөний код (room code): **6 тэмдэгт**, андуурагдах тэмдэгтгүй (O/0, I/1/L байхгүй). Coach кодыг **шинэчилж (regenerate)** болно; хуучин код ажиллахаа болино.

### A2. Нэгдэх (Joining)
- Сурагч timer-ийн одоо байгаа Google нэвтрэлтээр (Google sign-in) нэвтэрнэ.
- Өрөөний кодыг оруулна → coach хүсэлтийг баталгаажуулна (approve).
- Coach сурагчийг өрөөнөөс хасаж (remove) болно. Хасагдсан сурагчийн түүх ба дууссан challenge-үүд **хадгалагдана**. Сурагч **өөрийн түүхийг үргэлж харна**; зөвхөн **coach-ийн** харагдац нуугдана, дахин нэмэгдвэл coach-д **дахин харагдана**.
- Сурагч **олон өрөөнд** (олон coach-д) байж болно.
- Нэг coach өөр coach-ийн өрөөнд **сурагч** болж болно.

### A3. Challenge-ийн загвар (template)
**[төрөл (event)] + [хэмжүүр (metric)] + [зорилт (target): < X секунд] + [дараалан M удаа (M times in a row)]**

- Хэмжүүр (metric): **Single, Mo3, Ao5, Ao12, Ao25, Ao50, Ao100**-оос сонгоно.
- **M**: coach дурын бүхэл тоо бичнэ, **M ≥ 1** (алдаанаас хамгаалж дээд хязгаар **100**).

Жишээ:
- 2x2 Ao5 < 2.00 × 5 дараалан
- 3x3 Ao12 < 15.00 × 1
- 3x3 Single < 10.00 × 10 дараалан
- Pyraminx Mo3 < 5.00 × 3

### A4. Блок (block) ба streak
- Дундажуудыг **тусдаа блокоор** тоолно: 1–5-р эвлүүлэлт = 1-р блок, 6–10 = 2-р блок … Гулсах (rolling) дундаж **биш**.
- AoN / MoN нь WCA-ийн дүрмээр (trim, DNF-ийн боловсруулалт): `lib/timer-engine.ts`-ийн `avgOfN` / `trimCount`-ийг дахин ашиглана (Ao5–Ao50: 1-ийг, Ao100: 5-ыг тус бүр талаас хасна).
- **Single** бол эвлүүлэлт бүр нэг блок.
- Зорилттой харьцуулах: **дэлгэцэнд харагдах цаг** (centisecond хүртэл тайрсан, truncated) нь зорилтоос **хатуу бага** байх ёстой: 2.00 нь "< 2.00"-г **давахгүй**, 1.99 давна.
- Аль нэг блок унавал (fail) streak **0** болно.
- Session дуусахад **дуусаагүй блок** (жишээ нь Ao5-ийн 3/5) **тооцогдохгүй**, "оролдсон блок"-д ч орохгүй.

### A5. Оноох (assignment)
- Нэг challenge-ийг олон сурагчид нэг дор оноож (assign) болно.
- Сурагч олон challenge-ийг зэрэг хөөж болно, гэхдээ нэг зэрэг зөвхөн **НЭГ ажиллаж буй session** (running session) байна.
- Challenge-ийг **анх эхлүүлэх хүртэл** засаж болно; эхэлсний дараа **түгжигдэнэ**. Өөрчлөх бол coach **хувилж (duplicate)** шинэ хувилбар үүсгэнэ.

### A6. Эхлүүлэх ба дуусгах (start / end)
- Сурагчийн challenge-ийг **зөвхөн coach** эхлүүлнэ (клубт биечлэн), **coach-ийн өөрийн төхөөрөмжөөс**. Тэгэхэд сурагчийн timer дээр идэвхжинэ.
- **"Эхлүүлэх"** дарахдаа coach **дуусах цаг** (end time, ж.нь 18:00, хичээл дуусах цаг) тохируулна; session тэр үед автоматаар хаагдана. Тохируулаагүй бол Улаанбаатарын цагаар **өдрийн төгсгөл, шөнийн 00:00 (GMT+8)**.
- Дуусах цаг нь **тухайн өдөрт** (Улаанбаатарын цагаар, хамгийн оройдоо **23:59**) байх ба одооноос **дор хаяж 10 минутын дараа** байна.
- Эхлүүлэх үед сурагч offline байвал: сурагч timer-ээ нээхэд идэвхжинэ (дуусах цаг хүртэл).
- Сурагч **"Өнөөдрийг дуусгах"** товч дарж эрт дуусгаж болно.
- Нэг өдөр coach **дахин session** эхлүүлж болно.
- Ахиц (progress) session хооронд **үргэлжлэхгүй**: дараагийн session 0-ээс эхэлнэ.

### A7. Challenge-ийн үеийн timer (anti-cheat ба тохиргоо)
- Зөвхөн **гар/хүрэлтийн timer**-ээр (keyboard / touch) хэмжсэн эвлүүлэлт тоологдоно. **Bluetooth smart timer** (GAN / QiYi) challenge-ийн үед **хориотой** (дараа нь магадгүй).
- Гараар цаг оруулах (manual entry) **хориотой**; цаг засах (edit) **хориотой**; эвлүүлэлт устгах (delete) **хориотой**.
- Эвлүүлэлт бүрийн дараа сурагч **OK / +2 / DNF баталгаажуулна** (confirm); баталгаажсаны дараа **өөрчлөх боломжгүй**. Баталгаажаагүй эвлүүлэлт тоологдохгүй, дараагийн эвлүүлэлт эхлэхгүй. Дуусах цаг болоход баталгаажаагүй байгаа эвлүүлэлт **хасагдана** (тоологдохгүй).
- Challenge-ийн эвлүүлэлтэд **тайлбар (comment) бичиж болно**.
- **Inspection унтраалттай** (off); challenge тус бүрээр тохируулахгүй.
- Төрөл (event) challenge-ийн төрөлд **түгжигдэнэ**.
- **"Ижил холилт" (shared scramble) идэвхгүй**; холилт санамсаргүй (random).
- Challenge-ийн эвлүүлэлтүүд тусдаа **"Challenge" timer session**-д орно: клубын **оноо (points) өгөхгүй**, энгийн session-ий статистикт **нөлөөлөхгүй**.
- Сервер (server) хуурамч цагийг шалгана: төрөл бүрээр **боломжгүй хурдан цаг** (тухайн төрлийн дэлхийн рекорд single-аас бага зэрэг доош доод хязгаар), хэт **ойрхон дараалсан** эвлүүлэлт. Татгалзсан эвлүүлэлт дээр сурагчид **"Цаг хэт хурдан байна"** гэж харагдана. Coach биечлэн байх нь үндсэн хамгаалалт.

### A8. Дуусгавар (completion)
- **Баталгаажсан** эвлүүлэлтүүд дээр streak **M**-д хүрмэгц challenge **шууд** "дууссан" (complete) гэж тэмдэглэгдэнэ.
- Шагнал: **✅ + баяр хүргэх дэлгэц** (celebration screen). Оноо/шагнал дараа.
- Хадгалах үзүүлэлт: анх эхэлсэн огноо (first started), дууссан огноо (completed), зарцуулсан өдөр (days taken = Улаанбаатарын цагаар анх эхэлсэн өдрөөс дууссан өдөр хүртэлх **хуанлийн өдөр, хоёр талыг оруулан**: нэг өдөр эхэлж дуусвал **1 өдөр**), session-ийн тоо, нийт оролдсон блок (total blocks attempted), хамгийн их хүрсэн streak (best streak).

### A9. UI
- Орох цэг (entry point): timer-ийн **Community** хэсэг дэх **"Challenge"**. Racing / Competition "Удахгүй" хэвээр.
- Ахицын зурвас (progress strip, ж.нь **●●○○○ 2/5**) timer-ийн **цифрийн яг дээр** байрлана. Цаг хэмжиж байх үед бусад UI-ийн адил **бүдгэрч алга болно**, timer зогсоход **буцаж гарна**.
- Coach **шууд хяналтын** (live view) дэлгэцтэй.
- Monochrome design tokens; popup trigger-үүд дээр chevron **байхгүй**.

---

## PART B — Technical plan

### B1. Auth today, and the coach role

**How login works now**
- `lib/auth-context.tsx`: Google popup sign-in (`signInWithPopup`). On every sign-in `upsertUserDoc` creates or refreshes `users/{uid}`. One `onSnapshot` on the user's own document keeps `points / role / athleteId / totalSolves` live.
- `users/{uid}.role` is a **single value**: `'member' | 'athlete' | 'admin'`.
- **Admin** = `users/{uid}.role == 'admin'`, checked in three places:
  - `isAdmin()` in `firestore.rules`;
  - `isAdminUid()` in `lib/server/firebase-admin.ts` (server routes);
  - `user.role === 'admin'` in the UI.
- The admin changes roles in `components/admin/UsersTab.tsx` with `updateDoc(users/{uid}, { role })`. Linking an athlete also sets `role: 'athlete'`.
- `firestore.rules` → `match /users/{uid}`:
  - users may update **any field of their own doc except `role`**;
  - reads are self or admin only. Nobody can read another user's name or photo.
- Judges use a separate custom-token session (`role: 'judge'` claim) with no users doc. The new rules must refuse it.

**Coach role (decision 2): a separate `coaches/{uid}` document, written only by the admin. Admins count as coaches automatically.**

Why not a new `role: 'coach'` value:
- `role` is single-valued, and a coach is often also an athlete. One value can't be both.

Why not a `users/{uid}.isCoach` field:
- The current users rule would let anyone set it on themselves. A new admin-only collection avoids touching that rule and its tests (`tests/firestore-rules/users.test.mjs`).

Shape:
```
coaches/{uid}
  uid:        string
  displayName:string      // copied by the admin UI for coach lists
  active:     boolean     // false = revoked (keeps history readable)
  grantedBy:  string      // admin uid
  grantedAt:  timestamp
```
- **Rules:** read by the coach themself or an admin; write by admin only.
- **Check in rules:** `isCoach()` = `isAdmin()`, or `exists(coaches/uid)` with `active == true`.
- **Check on the server:** `isCoachUid(uid)` in `lib/server/firebase-admin.ts` = `isAdminUid(uid)`, or an active coach doc.
- **Admins** need no `coaches` doc; the UI shows the coach features to them directly.
- **A coach as a student** (decision 2): nothing extra is needed. Membership is per room, so a coach can hold a pending or active membership in someone else's room like any student.
- **How the admin grants it:** a "Coach эрх" toggle in the `UsersTab` row menu, which writes `coaches/{uid}`. A "Coach" filter chip lists coaches.
- **Note:** each rules `get()` / `exists()` counts as a billed read.

### B2. Firestore data model

Naming: `assignments` already exists (admin-only, public read, used elsewhere), so every new collection gets a `challenge*` or room-specific name.

```
rooms/{roomId}
  name:        string
  coachUid:    string
  code:        string           // 6 chars from "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
                                //   (no O/0, I/1/L) — decision 19
  createdAt:   timestamp
  archived:    boolean

roomCodes/{code}                // lookup by code with ONE get, no listing
  roomId:      string
  coachUid:    string
  // Regenerate (decision 19): one batch deletes the old roomCodes doc,
  // creates the new one (create-only, retried on a clash) and updates
  // rooms.code. The old code then resolves to nothing.

rooms/{roomId}/members/{studentUid}
  uid:         string
  displayName: string           // snapshot at join (users docs are private)
  photoURL:    string | null
  status:      'pending' | 'active' | 'removed'   // never deleted — decision 10
  requestedAt: timestamp
  decidedAt:   timestamp | null

challenges/{challengeId}
  coachUid:    string
  roomId:      string
  title:       string           // generated, e.g. "2x2 Ao5 < 2.00 × 5"
  event:       string           // timer EVENTS id ('222', '333', 'pyram', …)
  metric:      'single' | 'mo3' | 'ao5' | 'ao12' | 'ao25' | 'ao50' | 'ao100'   // decision 7
  targetMs:    int              // multiple of 10 (2-decimal seconds); strict "<"
  streak:      int              // M, 1 … 100 — decision 7
  locked:      boolean          // set true by the server at first start — decision 9
  duplicatedFrom: string | null // challengeId when created via "duplicate"
  createdAt:   timestamp
  archived:    boolean

challengeAssignments/{challengeId}_{studentUid}   // deterministic id = no duplicates
  challengeId, roomId, coachUid, studentUid: string
  studentName: string
  template:    { event, metric, targetMs, streak, title }   // denormalised → no extra read
  status:      'assigned' | 'in-progress' | 'completed' | 'archived'
  firstStartedAt: timestamp | null      // ┐
  firstStartedUbDate: string | null     // │ 'YYYY-MM-DD' (UB)
  completedAt:    timestamp | null      // │
  daysTaken:      int | null            // │ server-written only (decision 14)
  sessionsCount:  int                   // │
  blocksAttempted:int                   // │ complete blocks only (decision 5)
  bestStreak:     int                   // ┘
  assignedAt:  timestamp

challengeSessions/{sessionId}            // one per started session; several per day allowed (decision 15)
  assignmentId, challengeId, roomId, coachUid, studentUid: string
  template:    { event, metric, targetMs, streak }
  startedAt:   timestamp
  endsAt:      timestamp         // coach-set end time — decision 16, N2: same UB day,
                                 //   ≤ 23:59, ≥ now + 10 min; default = end of that UB day (00:00)
  ubDate:      string            // 'YYYY-MM-DD' (UB) at start
  status:      'active' | 'ended' | 'auto-closed' | 'completed'
  endedAt:     timestamp | null
  solves:      [{ seq: int, ms: int, penalty: 'none'|'+2'|'dnf',
                  stoppedAt: int /*client epoch ms*/, receivedAt: timestamp,
                  comment?: string }]
               // only CONFIRMED solves ever reach the server — decision 4
               // comment: optional, editable (decision N7); ms/penalty never change
  blocks:      [{ resultMs: int|null /*null = DNF*/, displayCs: int|null, pass: bool }]
  currentStreak, bestStreak, blocksAttempted: int
  flags:       [{ seq: int, reason: 'too-fast' | 'too-close' }]   // sanity-check rejections, for the coach

challengeLive/{studentUid}               // tiny pointer the student's timer listens to
  sessionId:   string | null
  assignmentId:string | null
  template:    { event, metric, targetMs, streak, title } | null
  endsAt:      timestamp | null
```

Design choices:
- **Solve log lives inside the session document** (an array). 150 solves are about 10 KB, far under 1 MB, and each confirmed solve costs about 1 read and 1 write.
- **`challengeLive/{uid}` is separate from the session**, so the student's listener only fires on start, end and completion, not on every solve.
- **Template copied into the assignment and the session**, so the timer never needs to read `challenges/*`.
- **Metric stored as one enum** (decision 7). N is derived: single → 1, mo3 → 3, ao5 → 5, ao12 → 12, ao25 → 25, ao50 → 50, ao100 → 100.

**Listeners vs one-time reads**

| Screen | Data | How |
|---|---|---|
| Timer page (student signed in, flag on) | `challengeLive/{me}` | **onSnapshot**: 1 read on load, then 1 per start, end or complete |
| Timer, during a session | progress | **no listener**; the solve API response returns the new progress |
| Challenge hub (`/timer/challenge`) | my rooms / my assignments | one-time `getDocs` (+ manual refresh) |
| Coach room page | room, members, challenges, assignments | one-time reads + refresh button |
| Coach room page, join requests | `members where status=='pending'` | onSnapshot **only while that tab is open** |
| **Coach live view** (decision 13) | `challengeSessions where roomId==X && status=='active'` | **onSnapshot while the live view is open**: 1 read per confirmed solve per student |
| History pages | assignment + its sessions | one-time reads, paginated (10 sessions/page) |

**Estimated reads for one typical class** (1 coach, 10 students, 2 hours, about 100 solves per student, coach live view open all class). These are planning estimates, not measurements.

| Item | Reads |
|---|---|
| Students load the timer about 3× each (pointer listener + rules `get()`s) | ≈ 30–40 |
| Coach starts 10 sessions (server checks coach, membership, assignment, pointer, challenge lock) | ≈ 60 |
| 1,000 confirmed-solve submissions (server transaction reads the session once) | ≈ 1,000 |
| Pointer updates pushed to 10 listeners (start + end) | ≈ 20 |
| **Coach live view** (re-read of the changed session on every solve) | ≈ 1,000 |
| Coach room page loads + refreshes | ≈ 100 |
| Session ends / auto-close | ≈ 20 |
| **Total** | **≈ 2,250** |

Writes come to about 1,050 per class. That's far below Firestore's daily free quota (50,000 reads per day at the time of writing; check current pricing). If it ever matters, the live view could instead listen to a per-room summary document written once per block, not once per solve.

### B3. Security rules and server routes

| Path | Read | Write |
|---|---|---|
| `coaches/{uid}` | self, admin | **admin only** |
| `rooms/{roomId}` | its coach; a member (pending or active) | create: `isCoach()` and `coachUid == me`; update: its coach (`name`, `archived`, `code` on regenerate); delete: none (archive) |
| `roomCodes/{code}` | **get** by any signed-in non-judge user; **no list** | create / delete: the coach of that room (regenerate = delete old + create new in one batch); create-only, so a clash fails and the client retries |
| `rooms/{id}/members/{uid}` | self; the room's coach **unless `status == 'removed'`** (decision 24) | create: self only, `status == 'pending'`, allowed keys only, name or photo from **own** users doc; update: **room coach only** (`pending → active`, `active → removed`, `removed → active` for re-add); delete: **none** (decision 10) |
| `challenges/{id}` | its coach | create: `isCoach()`, owns the room, metric in the 7 allowed values, `streak` int 1–100, `targetMs` positive multiple of 10, event in list, `locked == false`; update: its coach, **only while `locked == false`** (template fields), or `archived` any time; **`locked` is server-only**; delete: none |
| `challengeAssignments/{cid}_{uid}` | that student; that coach **while the student's membership is not `removed`** | create: coach of the challenge, student is an **active** member, progress fields absent or zero, status `'assigned'`; update by coach: `status → 'archived'` only; progress and status changes are **server-only** |
| `challengeSessions/{id}` | that student; that coach **while the membership is not `removed`** | **none** (server only) |
| `challengeLive/{uid}` | that student | **none** (server only) |

How decisions 10, 24 and N4 fit together:
- A removed student's documents stay in place.
- Their coach just can't read the membership, assignments or sessions while it's `removed`.
- Re-adding flips it back to `active` and everything is visible again to the coach.
- The **student always reads their own** membership, assignments and sessions, including while removed (decision N4). The student-side read rules don't look at `status`.

**Server routes are required** (Admin SDK, `verifyBearer`, same pattern as `app/api/staged/sync` and `app/api/judge/*`). The penalty route from the first draft is **gone**: solves arrive already confirmed, and their time and penalty are immutable (decision 4). Only the optional comment can still change (decision N7), through a small comment route.

| Route | Caller | Does |
|---|---|---|
| `POST /api/challenge/start` `{assignmentId, endsAt?}` | coach (or admin) | verifies the coach owns it and the student is an active member; **no other running session for that student** (decision 8; a second one the same day is fine, decision 15); `endsAt` (decision N2) must be on **today's UB date**, **no later than 23:59**, and **≥ now + 10 min**, else `400`; omitted → end of today (00:00 UB); creates the session; sets `challengeLive`; first start → sets `challenges.locked = true`, `firstStartedAt`, `firstStartedUbDate`; `sessionsCount++` |
| `POST /api/challenge/solve` `{sessionId, seq, ms, penalty, stoppedAt}` | student | transaction: session `active` and `now < endsAt` (else auto-close and reject); caller is its student; `seq` is next (an identical repeat is idempotent); **sanity checks** (below); append; recompute progress (complete blocks only); streak == M → `completed`, assignment stats (`completedAt`, `daysTaken`, `bestStreak`, `blocksAttempted`), clear pointer; returns progress |
| `POST /api/challenge/comment` `{sessionId, seq, comment}` | student | set or clear the comment on one of their own solves (decision N7); `ms` / `penalty` untouched; allowed after the session ends too |
| `POST /api/challenge/end` `{sessionId}` | student or coach | close (`ended`), clear the pointer, roll up assignment stats; any unfinished block is dropped (decision 5) |
| `POST /api/challenge/close-stale` | Vercel cron (secret header) | close any `active` session with `endsAt <= now` (`auto-closed`) |

**Sanity checks (decision 1)**, in `lib/challenge.ts` so they can be tuned in one place:
- **Impossible times per event (decision N5, confirmed).** Refuse a solve faster than a per-event floor set **slightly below the current world-record single**. The values are kept in one table in `lib/challenge.ts` (e.g. 2x2 ≈ 0.40 s, 3x3 ≈ 2.50 s, Pyraminx ≈ 0.70 s, Skewb ≈ 0.70 s, Square-1 ≈ 3.0 s, Clock ≈ 1.8 s). Update it when a record falls below a floor.
- **Solves too close together.** Consecutive solves must fit in real time: `stoppedAt[seq] − stoppedAt[seq−1] ≥ ms[seq]` (with a small tolerance). Server `receivedAt` must increase, and the interval must not exceed the time since the session started.
- **What happens to a failed check.** The solve is refused (`409`, with the reason) and a flag is added for the coach's live view. The student sees **"Цаг хэт хурдан байна"** (decision N5).
- **Bluetooth.** The route only accepts solves the client reports as on-screen-timer solves. That's a sanity flag, not proof; the timer UI enforces it (decision 3).

**Deploying:**
- `firestore.rules` changes take effect only after `firebase deploy --only firestore:rules`.
- New indexes need `firebase deploy --only firestore:indexes` and entries in `firestore.indexes.json`:
  - `challenges(coachUid, createdAt desc)`
  - `challengeSessions(assignmentId, startedAt desc)`
  - `challengeSessions(roomId, status)`
  - `challengeSessions(status, endsAt)`
  - `challengeAssignments(studentUid, assignedAt desc)`
- Server env: the existing `FIREBASE_ADMIN_*` variables, plus `CRON_SECRET`.

### B4. Timer integration

**Where solves are recorded today**
- `lib/timer-engine.ts`:
  - `useTimer` calls `onSolveCommit(ms, penalty)` from `stop()` and `finishExternal()` (Bluetooth).
  - It applies WCA inspection penalties when inspection is on.
  - `avgOfN` / `trimCount` compute AoN.
- `app/timer/page.tsx`:
  - `onSolveCommit` appends to the active local session. Solves live only in `localStorage` (`pv.timer.sessions.v2`).
  - Every path that mutates solves:

| Path | Kind |
|---|---|
| `deleteSolve`, `deleteLastSolve`, `confirmDeleteSelected` | delete |
| Alt+D clear | clear session |
| `setSolvePenalty`, `setPenaltyOnLast`, `togglePenaltyOnLast`, `undoPenaltyOnLast` | penalty |
| `setSolveComment` | comment |
| `commitManualInline` (manual mode) | manual entry |
| `switchSession`, `createSession`, `deleteSession` | session management |
| `setEventId` | event switch |
| `finishExternal` | Bluetooth smart timers |

**How challenge mode hooks in**
- **`app/timer/useChallenge.ts`.** It listens to `challengeLive/{uid}` (signed in, `TIMER_FEATURES.challenge` on) and exposes `active` (session, template, `endsAt`). It owns an ordered **submit queue**, mirrored to `localStorage`, that posts **confirmed** solves to `/api/challenge/solve`. It keeps the last returned progress and also runs `computeProgress` locally for instant feedback.
- **Entering challenge mode** (decisions 3, 11, 12, 22, 23):
  - the current local session id is remembered;
  - the timer switches to a dedicated local **"Challenge"** session for the event (created if missing), so normal sessions and their stats are untouched;
  - `eventId` is locked to `template.event`;
  - inspection is forced **off**;
  - `timeEntryMode` is forced to keyboard/touch (manual and Bluetooth hidden, and a connected smart timer is ignored);
  - shared scramble ("Ижил холилт") is suspended, and its view shows "Challenge-ийн үед идэвхгүй";
  - scrambles are random.

  **Leaving** restores the previous session, event, inspection and shared-scramble state.
- **Confirmation step (decision 4).** After each stop the solve is **pending**.
  - **What the student sees:** a mandatory row of **OK / +2 / DNF** in place of the usual action row. Arming the next solve is blocked until they choose.
  - **On confirm:** the solve is saved to the Challenge session with its final penalty and queued for the API. Its time and penalty are immutable from then on: no penalty buttons, no delete, Alt+D ignored.
  - **Comments:** stay **allowed** (decision N7). The comment button and editor work as usual; on a challenge solve they save locally and call `/api/challenge/comment`.
  - **Pending solves:** these are persisted locally too, so a refresh shows the confirmation again.
  - **Pending solve at the end time (decision N3):** dropped. It's removed from the pending slot, never sent, and doesn't appear in the Challenge session.
- **No points, no normal stats (decision 11).** In challenge mode, `onSolveCommit` skips `awardSolvePointIfUnderLimit` and the Ao5-PB award. The Challenge session isn't one of the user's normal sessions.
- **Blocks and streak**, as a pure function in `lib/challenge-progress.ts`:
  - `computeProgress(template, confirmedSolves) → { blocks, currentStreak, bestStreak, blocksAttempted, completed, pendingInBlock }`.
  - Single = each solve is a block. AoN = `avgOfN(block, N)` (Ao100 trims 5 per end). Mo3 = mean of 3, any DNF → DNF.
  - **Pass (decision 6):** result not DNF and `floor(resultMs / 10) < targetMs / 10`. That's the displayed centiseconds: `fmtMs` truncates, and `avgOfN` already rounds the mean to whole ms first. So 1999 ms (1.99) passes "< 2.00" and 2000 / 2009 ms (2.00) fail.
  - A fail resets `currentStreak` to 0. **Only complete blocks count** toward `blocksAttempted` (decision 5). Completed when `currentStreak == streak`.
  - The **server** is the authority; the **client** uses the same function for instant UI.
- **Progress strip (decision 21).** It sits just above the timer digits.
  - **Content:** streak dots **●●○○○ 2/5**, the current block "3/5", and a short template label.
  - **Large M:** for M > 10 the dots collapse to a compact bar plus "23/50".
  - **Ending early:** a small "Өнөөдрийг дуусгах" action sits nearby (desktop tools panel and mobile strip area).
  - **Style:** monochrome; the green dot is used only for "active".
  - **While timing (decision N6):** the strip gets the existing focus-mode fade (`.timer-page.focus-mode … { opacity: 0 }`, 150 ms), so it disappears during arming and running with the rest of the UI and returns when the timer stops.
- **Completion (decisions 14, 17).**
  - **Celebration:** the server response marks it complete, and the timer shows ✅ and a celebration screen (title, date, sessions, blocks, best streak).
  - **Days taken (decision N1):** `daysTaken` is computed on the server as `(completion UB date − firstStartedUbDate) in days + 1`, so the same day = 1 and Monday → Wednesday = 3.
- **End time (decisions 16, 20).**
  - **On the student's timer:** it hides the strip when `now ≥ endsAt`, using a local timer to that instant.
  - **On the server:** every API call refuses and closes a session past `endsAt` (lazy), and the daily Vercel cron calls `/api/challenge/close-stale` to finish the rest. UB has no DST, so it's a fixed UTC+8.
- **Entry point:** a new `TIMER_FEATURES.challenge` flag, with a "Challenge" tile in the Community tab linking to `/timer/challenge`.

### B5. Realtime: how the student's timer learns "Эхлүүлэх"

1. The coach presses **Эхлүүлэх** and optionally sets the end time (same UB day, ≤ 23:59, ≥ 10 min from now; default end of day) → `POST /api/challenge/start`.
2. The server writes the session and `challengeLive/{studentUid}`, including `endsAt`.
3. The student's timer has `onSnapshot(challengeLive/{uid})` open (1 read on load) and switches into challenge mode within about a second.
4. **Offline student (decision 16):** the pointer just waits. When they next open the timer they get it on the initial read and enter challenge mode, unless `endsAt` has passed, in which case the next server call closes it.

An RTDB alternative is still possible (the project already uses RTDB for presence), but it isn't needed at this volume.

### B6. Testing approach

- **Unit (no emulator):** `scripts/test-challenge.ts` with an `npm run test:challenge` script. It covers:
  - all 7 metrics, including the Ao100 5 % trim and Mo3 with a DNF;
  - target truncation (1999 ms passes "< 2.00"; 2000 and 2009 ms fail);
  - a fail resets the streak; completion exactly at M; M = 1 and M = 100; M = 0 or 101 rejected;
  - an unfinished trailing block isn't counted;
  - several streak runs in one session;
  - `daysTaken` across UB midnight (same day = 1; Mon → Wed = 3);
  - end-time validation (another day, after 23:59, < 10 min from now → rejected);
  - the sanity-check helpers (per-event floor; `stoppedAt` gaps).
- **Rules (Firestore emulator):** `tests/firestore-rules/challenge.test.mjs`, added to `npm run test:rules`. It covers:
  - only the admin writes `coaches/*`; an admin counts as a coach without a doc; a revoked coach can't create rooms;
  - room code regenerate by its coach only;
  - students only create their own `pending` membership; memberships can't be deleted;
  - a removed member is hidden from the coach and visible again after re-add, while the removed student can still read their own membership, assignments and sessions;
  - challenge edit is allowed while unlocked and refused once `locked`; `locked` is not writable by clients;
  - assignments only for active members; nobody writes sessions, `challengeLive` or progress;
  - a judge token is refused everywhere;
  - the existing suites keep passing.
- **Server routes (Firestore + Auth emulators):** `tests/server-routes/challenge-routes.test.mjs`, same harness as `judge-routes.test.mjs`. It covers:
  - start by a non-coach → 403; admin start works;
  - start while another session is running → 409; a second start the same day after ending → OK;
  - `endsAt` in the past, on another UB day, after 23:59, or < 10 min from now → 400;
  - solve by another user → 403;
  - out-of-order `seq`; an idempotent repeat;
  - too-fast or too-close solve → 409 + flag (the client shows "Цаг хэт хурдан байна");
  - comment on an own solve → OK, `ms` / `penalty` unchanged; comment on someone else's → 403;
  - solve after `endsAt` → closed;
  - completion writes `daysTaken`, `bestStreak` and `blocksAttempted`;
  - `close-stale` without the secret → 401.
- **Playwright (coach + student in two contexts):** needs an env-gated emulator mode in `lib/firebase.ts` (never on in production). Flow:
  1. admin grants coach;
  2. coach creates a room and regenerates its code;
  3. student joins with the new code (the old code fails);
  4. coach approves;
  5. coach creates "3x3 Single < 10.00 × 3" and assigns it;
  6. coach presses Эхлүүлэх with an end time;
  7. the student's timer switches (event locked, inspection off, Ижил холилт disabled, manual and Bluetooth unavailable);
  8. each solve requires OK/+2/DNF, and arming is blocked until confirmed; a comment can be added;
  9. the strip ●○○ advances, fades while the timer runs and returns on stop, then resets on a slow solve;
  10. completion → ✅ celebration;
  11. the coach live view updated throughout;
  12. "Өнөөдрийг дуусгах";
  13. the student's normal session and points are unchanged;
  14. the coach removes the student; the student still sees their own history, the coach doesn't; re-adding brings it back for the coach;
  15. a solve left unconfirmed when the end time passes is dropped.

### B7. Build phases (Phase 1 = this plan)

**Phase 2: roles and rooms**
- **Add:**
  - `lib/types/challenge.ts`
  - `lib/firebase/services/coaches.ts`, `rooms.ts`
  - `app/timer/challenge/page.tsx` (hub: join by code, my rooms as student and as coach)
  - `app/timer/challenge/rooms/[roomId]/page.tsx` (members, requests, approve/remove/re-add, regenerate code)
- **Change:**
  - `lib/timer-features.ts` (+`challenge`)
  - `components/admin/UsersTab.tsx` (coach toggle and filter)
  - `app/timer/page.tsx` (Community tile)
  - `lib/server/firebase-admin.ts` (`isCoachUid`, admin included)
- **Rules:** `coaches`, `rooms`, `roomCodes`, `members` → `firebase deploy --only firestore:rules`.
- **Tests:** rules part 1; Playwright admin → coach → room → join → approve → remove/re-add.
- **What the user sees:** the admin marks coaches (admins already are). A coach creates rooms with a 6-character code and can regenerate it. Students join several rooms by code. The coach approves, removes and re-adds.
- **As built (2026-10-16).** These points replace the Phase 2 parts of B3 where they differ:
  - **All room writes are server routes:** `app/api/rooms/{create,rename,regenerate-code,join,member}`, built on `lib/server/rooms.ts`. Clients have **no** write access to `rooms`, `members` or `roomCodes`, and `roomCodes` is not client-readable at all (join looks the code up on the server). This is stricter than B3's client-write rules.
  - **Reject** (not in the earlier plan) deletes the pending request, since there's no history yet, so the student can ask again. **Remove** sets `status: 'removed'` and never deletes.
  - **Re-add:** a coach can't see removed students (decision 24), so re-adding = the removed student enters the code again (the same document goes back to `pending`) and the coach approves it.
  - **Membership fields:** members also carry `roomId`, `roomName` and `coachName`. A student's "my rooms" list is then one collection-group query and still works after removal (N4). It needs the `members.uid` collection-group index in `firestore.indexes.json`.
  - **Rooms** also carry `coachName`.
  - **Test-only emulator login:** `lib/firebase.ts` `EMULATOR_MODE`, guarded by `NODE_ENV !== 'production'` and `NEXT_PUBLIC_FIREBASE_EMULATORS=1`, and proven absent from production builds by `npm run test:emulator-guard`.

**Phase 3: challenge creation and assignment**
- **Add:**
  - `lib/challenge.ts` (7 metrics, M 1–100, target to ms, title text, duplicate)
  - `lib/firebase/services/challenges.ts`, `challengeAssignments.ts`
  - challenge form + assign-to-many + duplicate in the room page
  - "My challenges" in the hub
- **Rules:** `challenges` (edit only while unlocked), `challengeAssignments`.
- **Indexes:** `challenges(coachUid, createdAt)`, `challengeAssignments(studentUid, assignedAt)`.
- **Tests:** template validation unit tests; rules part 2.
- **What the user sees:** the coach builds "2x2 Ao5 < 2.00 × 5", ticks several students, and can edit it until it's first started (then only duplicate). Students see it as "Эхлээгүй".
- **As built (2026-10-16).** These points replace the Phase 3 parts of B2/B3 where they differ:
  - **All challenge and assignment writes are server routes:** `app/api/challenge/{create,update,delete,duplicate,assign,unassign}`, built on `lib/server/challenges.ts`. Clients have **no** write access to `challenges` or `challengeAssignments` (rules: `allow write: if false`). This is stricter than B3's client-write rules, as for rooms in phase 2.
  - **Edit lock:** `update` and `delete` return `409 locked` when `challenges.locked == true` **or** any assignment has started (`firstStartedAt` set or status not `assigned`). Phase 4's start route must set `locked: true` in the same transaction that starts the first session.
  - **Delete** (not in B3, which said archive only): allowed only while never started; it removes the challenge and its unstarted assignments. **Unassign:** deletes one assignment, only while it has never started. **Duplicate:** a new unlocked, unassigned copy (`duplicatedFrom` set), allowed locked or not; the UI opens it straight in the edit form.
  - **Assign:** all-or-nothing. Every uid must be an **active** member (`409 not-active-member`). Students already assigned are skipped (deterministic id). Assigning more students to a locked challenge is allowed, since the template is fixed. Cap: 200 assignments per challenge, so an edit fits in one transaction.
  - **Extra fields:** `challenges.note` and `updatedAt`. The assignment's `template` also carries `note`. `title` is the coach's title or the generated one.
  - **`challengeAssignments.visibleToCoach`** (new): a rule can't `get()` the membership per document in a list query, so the coach's read is `coachUid == me && visibleToCoach == true`. `lib/server/rooms.ts` sets it `false` on remove and `true` on approve (re-add), in the same transaction. The student always reads their own (N4).
  - **Events:** the timer's event ids except `333fm` and `333mbf`, since their result isn't a single time (`CHALLENGE_EVENTS` in `lib/challenge.ts`). Target input: `2`, `2.5`, `2.00`, `1:05.30`, `65.3`; at most 2 decimals; max 59:59.99.
  - **Status words:** `assigned` → "Оноогдсон", `in-progress` → "Идэвхтэй", `completed` → "Биелсэн". The student sees "Багш эхлүүлэхийг хүлээнэ үү" until the coach starts it.
  - **Hub reads (changes B2's table):** the student's memberships and assignments are **onSnapshot** listeners while the hub is open (one read per document on open, then one per change), so an approval or a new assignment shows at once. The "Шинэчлэх" button is gone. The coach room page reads challenges and assignments once and re-reads after each action.
  - **Wording:** student- and coach-facing text says "Багш", not "Coach". The admin users tab keeps "Coach эрх".
  - **Indexes:** as planned, `challenges(coachUid, createdAt desc)` and `challengeAssignments(studentUid, assignedAt desc)`. The coach's room queries are equality-only and need no composite index.
  - **Tests:** `npm run test:challenge` (unit), `tests/firestore-rules/challenge.test.mjs` (in `test:rules`), `tests/server-routes/challenge-routes.test.mjs` (in `test:routes`), `npm run test:e2e:challenges` (Playwright coach + 3 students).

**Phase 4: challenge mode on the timer**
- **Add:**
  - `lib/challenge-progress.ts` (blocks/streak, truncation, UB date)
  - sanity checks in `lib/challenge.ts`
  - `lib/server/challenge.ts`
  - `app/api/challenge/{start,solve,comment,end,close-stale}/route.ts`
  - `app/timer/useChallenge.ts`
  - progress-strip, confirm-row and celebration components
  - coach live view
  - `vercel.json` cron
- **Change:**
  - `app/timer/page.tsx` (Challenge session, locks, inspection off, Ижил холилт off, confirm gate, no points)
  - room page (Эхлүүлэх with end-time picker; live view)
- **Rules:** `challengeSessions` (read: student / coach unless removed), `challengeLive` (read: student) → deploy.
- **Indexes:** `challengeSessions(roomId, status)`, `challengeSessions(status, endsAt)`.
- **Env:** `CRON_SECRET`.
- **Tests:** `test:challenge`, `challenge-routes`, Playwright two-context flow.
- **What the user sees:** the coach presses Эхлүүлэх and picks an end time (today, ≤ 23:59, at least 10 minutes ahead). The student's timer locks into the challenge with ●●○○○ above the digits (hidden while timing). The student confirms each solve and can comment on it; a refused time shows "Цаг хэт хурдан байна". They get ✅ and a celebration on completion, and the session closes at the end time or with "Өнөөдрийг дуусгах". The coach watches every student live.
- **Split (owner, 2026-10-16):** phase 4 is built in two parts. **4a** is core challenge mode: start/stop, the timer locks, confirm, scoring, sanity checks, end rules, completion with a simple "✅ Challenge биеллээ", and statuses. **4b** is the coach live view, the celebration screen, the Vercel cron (`close-stale`, `CRON_SECRET`), the coach's flag list, and the two `challengeSessions` indexes those need.
- **As built, 4a (2026-10-16).** These points replace the Phase 4 parts of A6, B2, B3 and B4 where they differ:
  - **Routes:** `app/api/challenge/{start,solve,comment,end}` on `lib/server/challenge-sessions.ts`. Clients have **no** write access to `challengeSessions` or `challengeLive`, as for every other challenge collection. `close-stale` is 4b.
  - **Default end time is 23:59 UB** (owner, 4a brief), not 00:00. It's the latest time N2 allows. The coach's picker defaults to 23:59; omitting `endsAt` on the route also means 23:59. After 23:49 UB no valid end time is left for that day, so the start returns `400 end-too-soon`.
  - **Shared scoring:** `lib/challenge-progress.ts` holds `computeProgress`, UB dates, `daysTaken` and `validateEndsAt`. The sanity checks are in `lib/challenge.ts` (`MIN_SOLVE_MS`, `sanityCheck`). The pure solve and stats helpers (`avgOfN`, `trimCount`, `fmtMs`, `Solve` …) moved from `lib/timer-engine.ts` to the new `lib/solve-stats.ts`, because the engine is a `'use client'` module the server can't import. The engine re-exports them, so existing imports are unchanged.
  - **Per-event floors (N5)** in `MIN_SOLVE_MS`, in ms: 333 2500, 222 400, 444 12000, 555 28000, 666 50000, 777 80000, 333oh 5000, 333bld 10000, 444bld 45000, 555bld 100000, pyram 700, skewb 700, sq1 3000, clock 1800, minx 20000.
  - **Too close together:** refused when `stoppedAt − previous stoppedAt < ms − 300 ms`, or when the session's solve times add up to more than the server time since `startedAt` plus 5 s. A refusal answers `409 too-fast` / `409 too-close` and is appended to the session's `flags`; the coach's flag list is 4b. The route also requires `input: 'timer'` (B3's "on-screen-timer solves only" sanity flag).
  - **Lazy end (decision 20):** every route closes an expired session first. When `start` finds the student's pointer on an expired session, it closes that one (`auto-closed`) and then starts. When the timer opens on an expired pointer, it calls `/api/challenge/end`, which closes it as `auto-closed`. With no cron yet, an expired session that nobody touches stays `active` with a past `endsAt`. Every reader treats it as not running.
  - **Extra fields:**
    - **Assignment:** `activeSessionId` and `activeEndsAt` (so the coach's page can offer "Зогсоох" without reading sessions), and `completedUbDate`. Stats roll up into the assignment when a session closes (`blocksAttempted` added, `bestStreak` max).
    - **Session:** `visibleToCoach`, the same flag and rule as assignments; `lib/server/rooms.ts` flips it on remove / re-approve.
    - **Live pointer:** its `template` also carries `title` and `note`.
  - **Rules:**
    - `challengeSessions`: the student reads their own; the coach reads while `visibleToCoach == true`.
    - `challengeLive/{uid}`: only that student reads it.
    - Both collections: no client writes.
  - **Indexes:** none added in 4a. Its only queries are server-side equality queries, which need no composite index. `challengeSessions(roomId, status)` and `(status, endsAt)` come with 4b's live view and cron.
  - **Timer (B4):**
    - **Challenge session:** a local session with the fixed id `challenge` per event, named "Challenge". It stays in the session list afterwards.
    - **What is overridden:** inspection, time-entry mode, shared scramble and Bluetooth are overridden while the mode is on, not written to the user's prefs. Nothing needs restoring except the event and the selected session, which are kept in `localStorage` (`pv.timer.challenge.prev.v1`).
    - **Blocked during the mode:** event pickers, Alt+key, and session switch / create / delete show "Challenge-ийн үед боломжгүй".
    - **Final solves:** a confirmed challenge solve is marked `solve.challenge = { sessionId, seq }` and can never be edited or deleted. That holds on every path (action row, shortcuts, two-finger gestures, detail modal, bulk delete, the sidebar ×), and also after the mode ends. Only its comment can change. Comments are limited to 280 characters, the timer's comment box limit.
    - **Refused solve:** removed from the Challenge session; the later queued solves are renumbered.
  - **Statuses:** `in-progress` shows as "Идэвхтэй" from the first start until completion. While a session runs, the student also sees "Явагдаж байна · HH:MM хүртэл" with a link to the timer, and the coach sees "HH:MM хүртэл" plus "Зогсоох". "Биелсэн" shows the first-started and completed dates, days taken, sessions, blocks and best streak. The coach's room page gained "Шинэчлэх", as B2 planned.
  - **Found, not changed:** a normal solve's club point only reaches the database for admins. `awardSolvePointIfUnderLimit` writes a `pointTransactions` row, and the rules make that collection admin-write only, so the whole transaction fails for other users. This is outside the challenge scope; the 4a e2e uses an admin student so its "no points from challenge solves" check has a real baseline.
  - **Tests:**
    - `npm run test:challenge`: adds scoring, UB dates, end time and sanity checks.
    - `tests/firestore-rules/challenge.test.mjs`: adds sessions, live pointer and progress fields.
    - `tests/server-routes/challenge-session-routes.test.mjs`: in `test:routes`.
    - `npm run test:e2e:challenge-mode`: Playwright, coach and student.
    - The route and e2e suites need a valid end time today, so they must run **before 23:45 UB**. *(Lifted in 4b: the tests now use a test clock.)*
- **As built, 4b (2026-10-17).** These points replace the Phase 4 parts of B2, B3 and B4 where they differ:
  - **Coach live view** (decision 13), `components/timer/challenge/CoachLiveView.tsx`, on the room page. It shows one row per running session:
    - event and metric, block progress (`2/3`), and the streak (●●○, or a bar with `23/50` when M > 10);
    - the last block's result (`1.61 ✓` / `DNF ✗`), the solve count, and "HH:MM хүртэл";
    - a **⚑ n** flag when the sanity checks refused solves. Tapping it lists the clock time, the solve time and the reason ("хэт хурдан" / "хэт ойрхон").
    - A student who completes while the page is open shows as "✅ Биелсэн" at once.
  - **Listeners on the coach room page.** Both stop when the page unmounts.
    - **Running sessions:** `challengeSessions where roomId == X, coachUid == me, visibleToCoach == true, status == 'active'`. B2's listener, plus the two filters the rules need. It costs about 1 read per confirmed solve per student, which is B2's ≈1,000 per class.
    - **The room's assignments,** now live too. B2 had them as a one-time read plus a refresh button. An assignment changes only at start, close and completion (≈3 writes per session, ≈30–60 reads per class), never per solve. That's what makes a start, an end and "Биелсэн" appear without a refresh, so **"Шинэчлэх" is gone**.
    - **The challenge list** stays a one-time read, re-read after the coach's own actions. Only those actions change it.
    - **Read budget:** the class estimate stays ≈2,250 reads. The removed refresh button's "≈100" line becomes the assignment listener.
    - **Expired sessions:** a session past its end time that nothing has closed yet is filtered out client-side.
  - **Celebration** (decision 17), `ChallengeCelebration` in `components/timer/challenge/TimerChallenge.tsx`.
    - **Look:** full-screen, using the challenge pages' monochrome tokens with #34D399 as the only colour. It shows "✅ Challenge биеллээ", the challenge sentence, days taken, sessions, total blocks and the completion date.
    - **The ✅ glyph:** drawn in text presentation (U+FE0E) inside a thin green ring, so it takes the accent colour rather than the platform's emoji green.
    - **Motion:** one entrance (fade, rise, the ✅ settles, the lines stagger); no confetti; no animation under `prefers-reduced-motion`.
    - **"Үргэлжлүүлэх"** closes it; the timer is already back in normal mode underneath.
    - **Where the numbers come from:** the completing solve's response now carries `result` (`daysTaken`, `sessionsCount`, `blocksAttempted`, `bestStreak`, `completedUbDate`).
  - **Cron:** `vercel.json` runs `/api/challenge/close-stale` daily at `5 16 * * *` UTC (00:05 UB).
    - **Method:** the route answers **GET**, which is how Vercel calls crons, and also POST for manual runs (B3 listed POST).
    - **Auth:** `Authorization: Bearer <CRON_SECRET>`, compared in constant time. A missing or wrong header gets 401. If `CRON_SECRET` isn't set, the route answers **503** and does nothing, so it is never open.
    - **What it closes:** `closeStaleSessions()` (index `challengeSessions(status, endsAt)`) closes every `active` session with `endsAt <= now` as `auto-closed`, using the same `closeInTx` as every other end. Each session is re-checked in its own transaction, so a second run, or a race with the student's own end, closes nothing twice.
    - **Timing:** on Vercel's Hobby plan a daily cron may fire at any time within its hour. Nothing depends on the exact minute, because every route also closes expired sessions lazily.
  - **Test clock:** every time rule now reads `serverNow()` (`lib/server/clock.ts`) or `appNow()` (`lib/clock.ts`).
    - **On the server:** shifted by `PV_TEST_CLOCK_OFFSET_MS` only when `FIRESTORE_EMULATOR_HOST` is set (emulator data only) and `VERCEL` is not.
    - **In the browser:** shifted by `window.__pvTestClockOffset` only in the emulator test mode. That condition is inlined so production builds drop the branch.
    - **Proof:** `npm run test:emulator-guard` scans the client bundles for the marker and checks the server-side conditions. Auth token expiry keeps the real clock.
    - **The tests pin the app to 12:00 UB on today's UB date,** so they pass at any real hour. The 23:45 restriction is gone.
    - **The 23:50 run** (owner choice, 2026-10-17) proves the late-night rules instead of the full flow:
      - with rule N2 no valid end time is left, so the picker and the start route refuse (`end-too-soon`);
      - a session ending at 23:55 still runs and scores;
      - expired sessions are closed by the timer and by the cron.
      - It runs as `npm run test:e2e:challenge-mode:late`, and as a second `next start` server pinned to 23:50 inside the session route test.
  - **Indexes:** `challengeSessions(roomId, status)` and `challengeSessions(status, endsAt)`, as planned.
  - **Rules:** no new rules; the 4a session rule already covers the live query. New rule tests cover it:
    - the coach's live query is allowed only with the `visibleToCoach` filter, and never returns a removed student's session;
    - another coach and students are refused.
  - **Env:** `CRON_SECRET` (Vercel → Production).
  - **Fixed along the way** (an existing timer bug the 4b e2e exposed): the timer's localStorage loaders marked "loaded" with a ref, so the save effect ran once with the empty initial state and wrote `{}`. Under React StrictMode in development, the second load then read that `{}` back and the user's sessions were lost; in production it was a brief overwrite that the next render repaired. Sessions, prefs and theme now use a state flag set together with the loaded data.
  - **Tests:**
    - `tests/firestore-rules/challenge.test.mjs`: adds the live-view queries.
    - `tests/server-routes/challenge-session-routes.test.mjs`: adds the test clock, the cron and the 23:50 server.
    - `npm run test:e2e:challenge-mode`: adds the live view, the flag, the celebration and live "Биелсэн".
    - `npm run test:e2e:challenge-mode:late`
    - `npm run test:emulator-guard`: adds the test clock checks.

**Phase 5: progress history**
- **Add:** history views for the student (per assignment; always visible to the student, even while removed) and the coach (per student / per challenge; hidden while the student is removed). One-time paginated reads.
- **Indexes:** `challengeSessions(assignmentId, startedAt)`.
- **Tests:** Playwright history check; server test that stats roll up across 3 sessions, including two on the same day.
- **What the user sees:** first started, completed, days taken, sessions, complete blocks attempted, best streak, plus a list of each session (date, end reason, blocks, best streak).

### B8. Open questions

**None.** All questions are answered in **Owner decisions (2026-10-16)**: 1–24 from the first draft and N1–N7 from the follow-up. Any new question found while building a phase should be added here and to that table with its own date.
