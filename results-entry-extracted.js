/**
 * ============================================================
 *  RESULTS ENTRY — Extracted Code from admin.html
 *  Structured as: 1) CSS  2) Variable Declarations  3) JS Functions
 * ============================================================
 */

/* ================================================================
   SECTION 1: CSS STYLES
   All styles relevant to the Results Entry interface.
   Copy these into a <style> block in your target HTML file.
   ================================================================ */

/*
:root {
  --bg: #080810;
  --surface: #0f0f1a;
  --card: #131325;
  --accent: #7c3aed;
  --accent2: #ec4899;
  --text: #e2e8f0;
  --muted: #64748b;
  --sidebar-bg: #0d0d1c;
  --option-bg: #1a1a30;
  --input-bg: rgba(255,255,255,0.04);
  --input-border: rgba(255,255,255,0.08);
}

// ===== TABS =====
.tab-nav {
  display: flex;
  gap: 0.2rem;
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 0.25rem;
  margin-bottom: 1.4rem;
  flex-wrap: wrap;
  position: relative;
  z-index: 10;
}
.tab-btn {
  padding: 0.42rem 0.9rem;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.tab-btn.active {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: #fff;
  font-weight: 600;
}
.tab-panel { display: none; }
.tab-panel.active { display: block; }

// ===== CARDS =====
.card {
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 1.5rem;
  margin-bottom: 1.4rem;
}
.card-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 1.2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.card-title .title-accent {
  display: inline-block;
  width: 3px;
  height: 1em;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  border-radius: 2px;
}

// ===== FORM GROUP / INPUT =====
.form-group { margin-bottom: 1rem; }
.form-group label {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 0.4rem;
}
.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.7rem 0.9rem;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  font-family: inherit;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
}
.form-input {
  width: 100%;
  padding: 0.7rem 0.9rem;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

// ===== MESSAGES =====
.msg {
  padding: 0.6rem 1rem;
  border-radius: 7px;
  font-size: 0.88rem;
  margin-top: 0.8rem;
  display: none;
}
.msg.success {
  background: rgba(34,197,94,0.12);
  border: 1px solid rgba(34,197,94,0.25);
  color: #4ade80;
}
.msg.error {
  background: rgba(244,63,94,0.12);
  border: 1px solid rgba(244,63,94,0.25);
  color: #f43f5e;
}
.msg.warn {
  background: rgba(251,191,36,0.12);
  border: 1px solid rgba(251,191,36,0.3);
  color: #fbbf24;
}

@keyframes panelToastFade {
  0%, 55% { opacity: 1; }
  100%     { opacity: 0; }
}
.panel-toast {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: center;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  margin-top: 0.4rem;
  border: none;
  background: transparent;
  animation: panelToastFade 2s ease forwards;
}
.panel-toast.success { color: #4ade80; }
.panel-toast.error   { color: #f87171; animation-duration: 3.5s; }

// ===== BUTTONS =====
.btn-sm-primary {
  padding: 0.45rem 1rem;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  border: none;
  border-radius: 7px;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-sm-primary:hover { opacity: 0.85; }

.btn-xs {
  font-size: 0.66rem; padding: 0.18rem 0.45rem; border-radius: 4px;
  cursor: pointer; font-family: inherit; line-height: 1.4;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04); color: var(--muted);
  transition: background 0.15s, color 0.15s;
}
.btn-xs:hover { background: rgba(255,255,255,0.1); color: var(--text); }

// ===== RESULTS ENTRY PANEL =====
.result-selectors {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
  align-items: flex-end;
}
.result-selectors .form-group {
  flex: 1;
  min-width: 140px;
  margin-bottom: 0;
}

// ===== SOLVE INPUTS =====
.solve-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}
.solve-label {
  font-size: 0.7rem;
  color: var(--muted);
  font-weight: 600;
  letter-spacing: 0.05em;
}
.solve-input {
  width: 80px;
  padding: 0.7rem 0.4rem;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #fff;
  font-family: monospace;
  font-size: 1rem;
  text-align: center;
  outline: none;
  transition: border-color 0.2s;
}
.solve-input:focus { border-color: var(--accent); }
.solve-input.dnf-val { color: #f43f5e; }

.solve-btns { display: flex; gap: 0.2rem; margin-top: 0.15rem; }
.solve-btn {
  flex: 1; font-size: 0.62rem; font-weight: 700; padding: 0.18rem 0.25rem;
  border-radius: 4px; cursor: pointer; font-family: inherit; line-height: 1;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.solve-btn-plus2 {
  border: 1px solid rgba(234,179,8,0.3);
  background: rgba(234,179,8,0.06); color: #d97706;
}
.solve-btn-plus2:hover, .solve-btn-plus2.active {
  background: rgba(234,179,8,0.22); border-color: rgba(234,179,8,0.7); color: #fbbf24;
}
.solve-btn-dnf {
  border: 1px solid rgba(244,63,94,0.3);
  background: rgba(244,63,94,0.06); color: #f87171;
}
.solve-btn-dnf:hover, .solve-btn-dnf.active {
  background: rgba(244,63,94,0.22); border-color: rgba(244,63,94,0.7); color: #f43f5e;
}

// ===== CALC ROW =====
.calc-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.calc-item { flex: 1; text-align: center; }
.calc-label {
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 0.2rem;
}
.calc-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: monospace;
  color: var(--text);
}
.calc-value.accent { color: #a78bfa; }
.calc-value.dnf    { color: #f43f5e; }

// ===== COMPACT MULTI-PANEL GRID =====
.multi-entry-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin-top: 1rem;
}
@media (max-width: 640px)  { .multi-entry-grid { grid-template-columns: 1fr !important; } }

.compact-panel {
  background: var(--card);
  border: 1px solid rgba(124,58,237,0.2);
  border-radius: 12px;
  padding: 0.85rem 0.9rem 0.75rem;
}
.compact-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.55rem;
}
.compact-panel-title {
  font-size: 0.72rem; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.compact-panel-actions { display: flex; gap: 0.25rem; }

.compact-select {
  width: 100%; margin-bottom: 0.3rem;
  padding: 0.32rem 0.5rem;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 7px; color: var(--text);
  font-size: 0.78rem; outline: none;
  transition: border-color 0.2s;
}
.compact-select:focus { border-color: var(--accent); }
.compact-select:disabled { opacity: 0.4; }

.compact-rg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; margin-bottom: 0.3rem; }

.compact-solves-row {
  display: flex; gap: 0.22rem; flex-wrap: nowrap;
  justify-content: space-between; margin-bottom: 0.55rem;
}
.compact-solves-row .solve-group { flex: 1; min-width: 0; }
.compact-solves-row .solve-input {
  width: 100%; padding: 0.5rem 0.15rem;
  font-size: 0.82rem;
}
.compact-solves-row .solve-btn { font-size: 0.58rem; padding: 0.15rem 0.1rem; }

.compact-calc-row {
  display: flex; gap: 0.5rem; margin-bottom: 0.5rem;
  background: rgba(124,58,237,0.06); border-radius: 7px;
  padding: 0.35rem 0.5rem;
}
.compact-calc-row .calc-item { flex: 1; text-align: center; }
.compact-calc-row .calc-label { font-size: 0.62rem; margin-bottom: 0.1rem; }
.compact-calc-row .calc-value { font-size: 0.95rem; }

// ===== INSPECTION TIMER =====
.insp-toggle-btn {
  font-size: 0.73rem; font-weight: 600;
  padding: 0.22rem 0.65rem; border-radius: 6px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.12);
  color: var(--muted); cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.insp-toggle-btn:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.insp-toggle-btn.active { background: rgba(124,58,237,0.12); border-color: rgba(124,58,237,0.35); color: #a78bfa; }

.insp-box {
  display: none;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.025);
  padding: 0.8rem 1rem 0.7rem;
  margin-top: 0.55rem;
  margin-bottom: 0.7rem;
}
.insp-box.visible { display: block; }

.insp-time-row {
  display: flex; align-items: baseline; gap: 0.55rem;
  margin-bottom: 0.45rem;
}
.insp-time {
  font-family: monospace; font-size: 2.4rem; font-weight: 700;
  letter-spacing: 0.02em; color: var(--text); line-height: 1;
  min-width: 5ch;
}
.insp-status {
  font-size: 0.8rem; font-weight: 700; letter-spacing: 0.06em;
  padding: 0.18rem 0.5rem; border-radius: 5px;
  border: 1px solid transparent;
  display: none;
}
.insp-status.visible { display: inline-block; }
.insp-status.warn   { background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.3); color: #fbbf24; }
.insp-status.warn2  { background: rgba(249,115,22,0.12); border-color: rgba(249,115,22,0.3); color: #fb923c; }
.insp-status.plus2  { background: rgba(251,191,36,0.15); border-color: rgba(251,191,36,0.4); color: #fde68a; }
.insp-status.dnf    { background: rgba(244,63,94,0.15);  border-color: rgba(244,63,94,0.4);  color: #f43f5e; }

.insp-time.state-warn  { color: #fbbf24; }
.insp-time.state-warn2 { color: #fb923c; }
.insp-time.state-plus2 { color: #fde68a; }
.insp-time.state-dnf   { color: #f43f5e; }

.insp-btns {
  display: flex; gap: 0.35rem; flex-wrap: wrap;
}
.insp-btn {
  font-size: 0.76rem; font-weight: 600;
  padding: 0.32rem 0.85rem; border-radius: 6px;
  cursor: pointer; font-family: inherit;
  transition: background 0.13s, border-color 0.13s;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05); color: var(--text);
  min-width: 56px; text-align: center;
}
.insp-btn:hover { background: rgba(255,255,255,0.1); }
.insp-btn.primary {
  background: rgba(124,58,237,0.2); border-color: rgba(124,58,237,0.45); color: #c4b5fd;
}
.insp-btn.primary:hover { background: rgba(124,58,237,0.32); }
.insp-btn:disabled { opacity: 0.38; cursor: default; }

@media (max-width: 480px) {
  .insp-time { font-size: 2rem; }
  .insp-btn  { flex: 1; padding: 0.4rem 0.5rem; }
}

// ===== COMPETITION RESULTS TAB (WCA Live Layout) =====
.badge-published {
  display: inline-block; padding: 0.12rem 0.45rem; border-radius: 4px;
  font-size: 0.7rem; font-weight: 700;
  background: rgba(34,197,94,0.14); border: 1px solid rgba(34,197,94,0.3); color: #4ade80;
}
.wca-live-layout {
  display: flex; min-height: 580px;
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.07);
}
.wca-sidebar {
  width: 210px; flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column;
}
.wca-sidebar-comp-sel {
  padding: 0.8rem 0.75rem 0.6rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.wca-sidebar-comp-sel select {
  width: 100%; padding: 0.35rem 0.45rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 7px; color: var(--text);
  font-size: 0.78rem; outline: none;
}
.wca-sidebar-events { flex: 1; overflow-y: auto; padding: 0.35rem 0; }
.wca-event-item {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.6rem 0.85rem; cursor: pointer;
  font-size: 0.83rem; color: var(--muted);
  border-left: 3px solid transparent;
  transition: background 0.12s, color 0.12s;
  user-select: none;
}
.wca-event-item:hover { background: rgba(255,255,255,0.04); color: var(--text); }
.wca-event-item.active {
  background: rgba(124,58,237,0.12); border-left-color: var(--accent);
  color: #c4b5fd; font-weight: 600;
}
.wca-event-short {
  font-size: 0.68rem; font-weight: 800; letter-spacing: 0.04em;
  width: 32px; text-align: center; flex-shrink: 0;
  color: #7c3aed;
}
.wca-event-item.active .wca-event-short { color: #a78bfa; }
.wca-main { flex: 1; min-width: 0; background: var(--card); display: flex; flex-direction: column; }
.wca-main-header {
  padding: 1rem 1.3rem 0.8rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: flex-start;
  justify-content: space-between; gap: 1rem; flex-wrap: wrap;
}
.wca-comp-title { font-size: 1.15rem; font-weight: 800; color: var(--text); }
.wca-comp-meta { font-size: 0.76rem; color: var(--muted); margin-top: 0.2rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.wca-event-round-bar {
  padding: 0.7rem 1.3rem 0;
  display: flex; align-items: center;
  justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;
}
.wca-event-round-title { font-size: 0.98rem; font-weight: 700; color: var(--text); }
.wca-round-tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
.wca-round-tab {
  padding: 0.22rem 0.65rem; border-radius: 20px;
  font-size: 0.76rem; font-weight: 600; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1);
  background: transparent; color: var(--muted);
  font-family: inherit; transition: all 0.15s;
}
.wca-round-tab:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.wca-round-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.cr-complete-btn {
  font-size: 0.72rem; font-weight: 700; padding: 0.22rem 0.65rem;
  border-radius: 6px; cursor: pointer; white-space: nowrap;
  border: 1px solid; font-family: inherit; transition: background 0.13s, color 0.13s, border-color 0.13s;
}
.cr-complete-btn.not-done {
  background: transparent; border-color: rgba(255,255,255,0.12); color: var(--muted);
}
.cr-complete-btn.not-done:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.cr-complete-btn.done {
  background: rgba(74,222,128,0.1); border-color: rgba(74,222,128,0.32); color: #4ade80;
}
.cr-complete-btn.done:hover {
  background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.32); color: #f87171;
}
.wca-group-tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; padding: 0.4rem 1.3rem 0; }
.wca-group-tab {
  padding: 0.15rem 0.5rem; border-radius: 14px;
  font-size: 0.72rem; font-weight: 600; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1);
  background: transparent; color: var(--muted); font-family: inherit; transition: all 0.15s;
}
.wca-group-tab:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.wca-group-tab.active { background: rgba(124,58,237,0.18); border-color: rgba(124,58,237,0.45); color: #c4b5fd; }
.wca-table-wrap { flex: 1; overflow-x: auto; padding: 0.6rem 1.3rem 1.2rem; }
.wca-results-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.wca-results-table thead th {
  padding: 0.5rem 0.55rem; text-align: left;
  font-size: 0.7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 2px solid rgba(255,255,255,0.07);
  white-space: nowrap; position: sticky; top: 0;
  background: var(--card); z-index: 2;
}
.wca-results-table thead th.th-r { text-align: right; }
.wca-results-table tbody tr {
  border-bottom: 1px solid rgba(255,255,255,0.03);
  transition: background 0.1s;
}
.wca-results-table tbody tr:hover { background: rgba(255,255,255,0.025); }
.wca-results-table tbody tr.row-gold   { background: rgba(234,179,8,0.07); }
.wca-results-table tbody tr.row-silver { background: rgba(148,163,184,0.05); }
.wca-results-table tbody tr.row-bronze { background: rgba(180,83,9,0.06); }
.wca-results-table tbody tr.row-club {
  background: rgba(124,58,237,0.07);
  border-left: 2px solid rgba(167,139,250,0.5);
  border-bottom: 1px solid rgba(124,58,237,0.12);
}
.wca-results-table tbody tr.row-club:hover { background: rgba(124,58,237,0.12); }
.wca-results-table tbody tr.row-club .wca-name {
  color: #e2d9ff;
  text-shadow: 0 0 12px rgba(167,139,250,0.25);
}
.wca-results-table tbody tr.row-imported { opacity: 0.72; }
.wca-results-table tbody tr.row-imported:hover { opacity: 1; background: rgba(255,255,255,0.02); }
.wca-results-table tbody tr.row-imported .wca-name { color: #94a3b8; font-weight: 500; }
.wca-results-table tbody tr.row-imported .wca-td-avg { color: #6b7cad; }
.wca-results-table tbody tr.row-imported .wca-td-best { color: #6b7cad; }
.wca-results-table tbody tr.row-nonqualified {
  opacity: 0.55;
  border-left: 2px solid rgba(239,68,68,0.5) !important;
}
.badge-nonqual {
  display: inline-block;
  font-size: 0.63rem; font-weight: 700;
  color: #f87171;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.wca-results-table tbody tr.row-dup-flag {
  background: rgba(245,158,11,0.08) !important;
  border-left: 2px solid rgba(245,158,11,0.6) !important;
}
.badge-dup-warn {
  display: inline-block;
  font-size: 0.65rem; font-weight: 700;
  color: #f59e0b;
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.35);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.dup-warning-banner {
  margin-bottom: 0.6rem;
  padding: 0.5rem 0.8rem;
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.35);
  border-radius: 6px;
  color: #f59e0b;
  font-size: 0.82rem;
  font-weight: 500;
}
.wca-results-table td { padding: 0.5rem 0.55rem; vertical-align: middle; }
.wca-td-rank { font-size: 0.78rem; font-weight: 700; color: var(--muted); min-width: 26px; }
.wca-rank-1 { color: #fbbf24; }
.wca-rank-2 { color: #94a3b8; }
.wca-rank-3 { color: #c2773d; }
.wca-td-name .wca-name { font-weight: 600; color: var(--text); font-size: 0.88rem; }
.wca-td-name .wca-country { font-size: 0.7rem; color: var(--muted); }
.wca-td-solve {
  font-family: monospace; font-size: 0.86rem;
  text-align: right; color: var(--muted); white-space: nowrap;
}
.wca-td-solve.best-solve { color: var(--text); font-weight: 700; }
.wca-td-solve.dnf-solve  { color: #f43f5e; }
.wca-td-avg {
  font-family: monospace; font-size: 0.93rem; font-weight: 700;
  text-align: right; color: #a78bfa; white-space: nowrap;
}
.wca-td-avg.dnf-avg { color: #f43f5e; }
.wca-td-best {
  font-family: monospace; font-size: 0.86rem; font-weight: 700;
  text-align: right; color: var(--text); white-space: nowrap;
}
.wca-row-actions { display: flex; gap: 0.22rem; align-items: center; white-space: nowrap; }
.wca-empty { text-align: center; padding: 3rem 1rem; color: var(--muted); font-size: 0.88rem; }
.wca-fade-in { animation: wcaFadeIn 0.18s ease; }
@keyframes wcaFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

.wca-results-table tbody tr.row-advancing .wca-td-rank {
  background: rgba(34,197,94,0.1);
  border-radius: 4px;
}
.adv-cutoff-row td {
  height: 2px !important;
  padding: 0 !important;
  background: rgba(34,197,94,0.3);
  border: none !important;
}
.adv-rule-text {
  font-size: 0.75rem;
  color: #4ade80;
  padding: 0.2rem 0.1rem 0.5rem;
  opacity: 0.9;
}

@media (max-width: 760px) {
  .wca-live-layout { flex-direction: column; }
  .wca-sidebar { width: 100%; min-height: auto; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .wca-sidebar-events { display: flex; flex-wrap: wrap; gap: 0.2rem; padding: 0.4rem 0.5rem; max-height: 110px; }
  .wca-event-item { border-left: none; border-radius: 8px; padding: 0.35rem 0.55rem; flex-direction: column; gap: 0.1rem; }
}
*/


/* ================================================================
   SECTION 2: HTML STRUCTURE
   Results Entry Tab (TAB 3) and Competition Results Tab (TAB 4)
   ================================================================ */

/*
<!-- ======= TAB 3: RESULTS ENTRY ======= -->
<div id="tabResults" class="tab-panel">
  <div class="card">
    <div class="card-title"><span class="title-accent"></span> Results Entry</div>
    <div class="result-selectors" style="margin-bottom:0.8rem;">
      <div class="form-group" style="max-width:340px;margin-bottom:0;">
        <label>Competition</label>
        <select id="resComp"></select>
      </div>
    </div>
    <div id="panelControls" style="display:none;align-items:center;gap:0.6rem;margin-bottom:0.25rem;flex-wrap:wrap;">
      <span style="font-size:0.8rem;color:var(--muted);">Panels: <strong id="panelCountLabel">1</strong></span>
      <button type="button" class="btn-xs" id="addPanelBtn" onclick="addPanel()">+ Add Panel</button>
      <button type="button" class="btn-xs" id="removePanelBtn" onclick="removePanel()">− Remove</button>
      <button class="insp-toggle-btn" id="inspToggleBtn" onclick="inspToggle()">⏱ Inspection Timer</button>
    </div>
    <div id="entrySelectPrompt" style="padding:1.5rem 1rem;text-align:center;color:var(--muted);font-size:0.88rem;">
      Select a competition above to start entering results.
    </div>
    <div class="insp-box" id="inspBox">
      <div class="insp-time-row">
        <span class="insp-time" id="inspTime">0.00</span>
        <span class="insp-status" id="inspStatus"></span>
      </div>
      <div class="insp-btns">
        <button class="insp-btn primary" id="inspStartBtn" onclick="inspStart()">Start</button>
        <button class="insp-btn" id="inspStopBtn"  onclick="inspStop()"  disabled>Stop</button>
        <button class="insp-btn" id="inspClearBtn" onclick="inspClear()">Clear</button>
      </div>
    </div>
    <div id="resultPanels" class="multi-entry-grid" style="display:none;">
      <!-- Injected by buildResultPanels() -->
    </div>
  </div>
</div><!-- /tabResults -->

<!-- ======= TAB 4: COMPETITION RESULTS ======= -->
<div id="tabCompResults" class="tab-panel">

  <!-- Inline edit card (hidden until Edit is clicked) -->
  <div class="card" id="editResultCard" style="display:none;">
    <div class="card-title"><span class="title-accent"></span> Edit Result</div>
    <div style="margin-bottom:0.8rem;">
      <div id="erAthlName" style="font-size:0.95rem;font-weight:600;color:var(--text);"></div>
      <div id="erEventName" style="font-size:0.8rem;color:var(--muted);margin-top:0.25rem;"></div>
    </div>
    <!-- Editable name/country — shown only when editing an imported result -->
    <div id="erImportedFields" style="display:none;margin-bottom:1rem;">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <div class="form-group" style="flex:2;min-width:160px;margin-bottom:0;">
          <label>Athlete Name</label>
          <input type="text" id="erImportedName" class="form-input" autocomplete="off" />
        </div>
        <div class="form-group" style="flex:1;min-width:110px;margin-bottom:0;">
          <label>Country</label>
          <input type="text" id="erImportedCountry" class="form-input" autocomplete="off" />
        </div>
      </div>
    </div>
    <div class="solves-row" style="margin-bottom:1rem;">
      <div class="solve-group">
        <span class="solve-label">S1</span>
        <input type="text" class="solve-input" id="er_solve_1" autocomplete="off"
          inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"
          oninput="erSyncInput(1)" onblur="formatSolveInput(this);erSyncInput(1)" />
        <div class="solve-btns">
          <button class="solve-btn solve-btn-plus2" id="er_plus2_1" type="button" onclick="erTogglePlus2(1)">+2</button>
          <button class="solve-btn solve-btn-dnf"   id="er_dnf_1"   type="button" onclick="erToggleDnf(1)">DNF</button>
        </div>
      </div>
      <div class="solve-group">
        <span class="solve-label">S2</span>
        <input type="text" class="solve-input" id="er_solve_2" autocomplete="off"
          inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"
          oninput="erSyncInput(2)" onblur="formatSolveInput(this);erSyncInput(2)" />
        <div class="solve-btns">
          <button class="solve-btn solve-btn-plus2" id="er_plus2_2" type="button" onclick="erTogglePlus2(2)">+2</button>
          <button class="solve-btn solve-btn-dnf"   id="er_dnf_2"   type="button" onclick="erToggleDnf(2)">DNF</button>
        </div>
      </div>
      <div class="solve-group">
        <span class="solve-label">S3</span>
        <input type="text" class="solve-input" id="er_solve_3" autocomplete="off"
          inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"
          oninput="erSyncInput(3)" onblur="formatSolveInput(this);erSyncInput(3)" />
        <div class="solve-btns">
          <button class="solve-btn solve-btn-plus2" id="er_plus2_3" type="button" onclick="erTogglePlus2(3)">+2</button>
          <button class="solve-btn solve-btn-dnf"   id="er_dnf_3"   type="button" onclick="erToggleDnf(3)">DNF</button>
        </div>
      </div>
      <div class="solve-group">
        <span class="solve-label">S4</span>
        <input type="text" class="solve-input" id="er_solve_4" autocomplete="off"
          inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"
          oninput="erSyncInput(4)" onblur="formatSolveInput(this);erSyncInput(4)" />
        <div class="solve-btns">
          <button class="solve-btn solve-btn-plus2" id="er_plus2_4" type="button" onclick="erTogglePlus2(4)">+2</button>
          <button class="solve-btn solve-btn-dnf"   id="er_dnf_4"   type="button" onclick="erToggleDnf(4)">DNF</button>
        </div>
      </div>
      <div class="solve-group">
        <span class="solve-label">S5</span>
        <input type="text" class="solve-input" id="er_solve_5" autocomplete="off"
          inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"
          oninput="erSyncInput(5)" onblur="formatSolveInput(this);erSyncInput(5)" />
        <div class="solve-btns">
          <button class="solve-btn solve-btn-plus2" id="er_plus2_5" type="button" onclick="erTogglePlus2(5)">+2</button>
          <button class="solve-btn solve-btn-dnf"   id="er_dnf_5"   type="button" onclick="erToggleDnf(5)">DNF</button>
        </div>
      </div>
    </div>
    <div class="calc-row">
      <div class="calc-item">
        <div class="calc-label">Single</div>
        <div class="calc-value" id="er_calcSingle">&mdash;</div>
      </div>
      <div class="calc-item">
        <div class="calc-label">Average</div>
        <div class="calc-value accent" id="er_calcAvg">&mdash;</div>
      </div>
    </div>
    <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem;">
      <button class="btn-sm-primary" onclick="saveEditedResult()">Save Changes</button>
      <button class="btn-sm-secondary" onclick="cancelResultEdit()">Cancel</button>
    </div>
    <div class="msg" id="erMsg"></div>
  </div>

  <!-- WCA Live layout -->
  <div class="wca-live-layout">
    <div class="wca-sidebar">
      <div class="wca-sidebar-comp-sel">
        <select id="crCompSel"></select>
      </div>
      <div class="wca-sidebar-events" id="crEventList">
        <div style="padding:0.9rem 0.85rem;color:var(--muted);font-size:0.8rem;">Loading…</div>
      </div>
    </div>
    <div class="wca-main">
      <div class="wca-main-header">
        <div>
          <div class="wca-comp-title" id="crCompTitle">Select a competition</div>
          <div class="wca-comp-meta" id="crCompMeta"></div>
        </div>
        <div id="crHeaderActions"></div>
      </div>
      <div class="wca-event-round-bar" id="crEventRoundBar" style="display:none;">
        <div class="wca-event-round-title" id="crEventRoundTitle"></div>
        <div class="wca-round-tabs" id="crRoundTabs"></div>
        <div id="crRoundCompleteArea"></div>
      </div>
      <div class="wca-group-tabs" id="crGroupTabs" style="display:none;"></div>
      <div class="wca-table-wrap">
        <div id="compResultsWrap"><div class="wca-empty">Select an event to view results.</div></div>
      </div>
    </div>
  </div>

</div><!-- /tabCompResults -->
*/


/* ================================================================
   SECTION 3: VARIABLE DECLARATIONS
   ================================================================ */

// --- Results Entry Panels ---
let numPanels = 1;
const panelState = [{ selectedAthlete: null }];

// --- Competition Results Tab ---
let allAdminResults = [];
let unsubCompResults = null;

// WCA Live view state
let crCompId = null;
let crEvId   = null;
let crRound  = 1;
let crGroup  = null;  // declared later in admin.html but used throughout crRender* functions

// Internal (needed by crRenderTable/startEditResult)
let editingResultDocId = null;


/* ================================================================
   SECTION 4: JAVASCRIPT FUNCTIONS
   All functions related to Results Entry and Competition Results.
   Dependencies: WCA_EVENTS array, athletesCache, competitionsCache,
   window.db (Firebase Firestore), escHtml(), t() (i18n).
   ================================================================ */

// ===========================
// WCA EVENTS REFERENCE
// ===========================
const WCA_EVENTS = [
  { id: '333',    name: '3x3x3 Cube',         short: '3x3'  },
  { id: '222',    name: '2x2x2 Cube',         short: '2x2'  },
  { id: '444',    name: '4x4x4 Cube',         short: '4x4'  },
  { id: '555',    name: '5x5x5 Cube',         short: '5x5'  },
  { id: '666',    name: '6x6x6 Cube',         short: '6x6'  },
  { id: '777',    name: '7x7x7 Cube',         short: '7x7'  },
  { id: '333bf',  name: '3x3x3 Blindfolded',  short: '3BLD' },
  { id: '333fm',  name: '3x3x3 Fewest Moves', short: 'FMC'  },
  { id: '333oh',  name: '3x3x3 One-Handed',   short: '3OH'  },
  { id: 'clock',  name: 'Clock',              short: 'CLK'  },
  { id: 'minx',   name: 'Megaminx',           short: 'MINX' },
  { id: 'pyram',  name: 'Pyraminx',           short: 'PYRA' },
  { id: 'skewb',  name: 'Skewb',             short: 'SKWB' },
  { id: 'sq1',    name: 'Square-1',          short: 'SQ-1' },
  { id: '444bf',  name: '4x4x4 Blindfolded', short: '4BLD' },
  { id: '555bf',  name: '5x5x5 Blindfolded', short: '5BLD' },
  { id: '333mbf', name: '3x3x3 Multi-Blind', short: 'MBLD' },
];

// ===========================
// getRoundNames
// ===========================
function getRoundNames(n) {
  const all = ['First Round', 'Second Round', 'Third Round', 'Semi Final', 'Final'];
  if (n <= 1) return ['Final'];
  if (n === 2) return ['First Round', 'Final'];
  if (n === 3) return ['First Round', 'Second Round', 'Final'];
  if (n === 4) return ['First Round', 'Second Round', 'Semi Final', 'Final'];
  // 5+
  const names = [];
  for (let i = 0; i < n - 2; i++) names.push(all[i]);
  names.push('Semi Final');
  names.push('Final');
  return names;
}

// ===========================
// TIME UTILITIES
// ===========================

// fmtTime — formats centiseconds to human-readable string
function fmtTime(cs) {
  if (cs === -1) return 'DNF';
  if (cs === -2) return 'DNS';
  if (cs === null || cs === undefined || cs === '') return '\u2014';
  cs = Number(cs);
  if (cs >= 6000) {
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${m}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
  }
  return `${Math.floor(cs/100)}.${String(cs%100).padStart(2,'0')}`;
}

// parseTime — parses a user-typed time string to centiseconds
// Returns: centiseconds (number), -1 for DNF, -2 for DNS, null for invalid
function parseTime(str) {
  str = str.trim().toUpperCase().replace(/\s*(PR|TR|NR|CR|WR)$/, '');
  if (str === 'DNF') return -1;
  if (str === 'DNS') return -2;
  if (!str) return null;
  let plus2 = false;
  if (str.endsWith('+')) { plus2 = true; str = str.slice(0, -1); }
  const colonIdx = str.indexOf(':');
  let cs;
  if (colonIdx !== -1) {
    const m = parseInt(str.slice(0, colonIdx));
    const rest = parseFloat(str.slice(colonIdx + 1));
    cs = Math.round(m * 6000 + rest * 100);
  } else {
    cs = Math.round(parseFloat(str) * 100);
  }
  if (isNaN(cs)) return null;
  return plus2 ? cs + 200 : cs;
}

// rawDigitsToTimeStr — converts pure digit string "12345" → "1:23.45"
function rawDigitsToTimeStr(digits) {
  var cc   = digits.slice(-2).padStart(2, '0');
  var rest = digits.length > 2 ? digits.slice(0, -2) : '';
  var ss   = rest.slice(-2);
  var mm   = rest.length > 2 ? rest.slice(0, -2) : '';
  var sNum = ss ? parseInt(ss, 10) : 0;
  if (mm) {
    return parseInt(mm, 10) + ':' + String(sNum).padStart(2, '0') + '.' + cc;
  }
  return sNum + '.' + cc;
}

// formatSolveInput — auto-formats a solve <input> element in-place
// If the value is pure digits (no dot/colon) converts to formatted time.
// Preserves trailing +, leaves DNF/DNS untouched.
function formatSolveInput(inp) {
  var raw = inp.value.trim();
  if (!raw) return;
  var upper = raw.toUpperCase();
  if (upper === 'DNF' || upper === 'DNS') return;
  var hasPlus = raw.endsWith('+');
  var core = hasPlus ? raw.slice(0, -1).trim() : raw;
  if (/^\d+$/.test(core)) {
    inp.value = rawDigitsToTimeStr(core) + (hasPlus ? '+' : '');
  }
}

// calcAo5 — compute Ao5 from an array of 5 solve values (centiseconds)
// Returns: centiseconds, -1 for DNF average, null if fewer than 5 solves
function calcAo5(solves) {
  const vals = solves.map(s => (s === null || s === undefined || s === '') ? null : Number(s)).filter(s => s !== null);
  if (vals.length < 5) return null;
  const dnfCount = vals.filter(v => v < 0).length;
  if (dnfCount >= 2) return -1;
  const sorted = [...vals].sort((a, b) => {
    if (a < 0 && b < 0) return 0;
    if (a < 0) return 1;
    if (b < 0) return -1;
    return a - b;
  });
  const middle = sorted.slice(1, 4);
  if (middle.some(v => v < 0)) return -1;
  const sum = middle.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / 3);
}

// bestSingle — returns the best (lowest positive) solve value
function bestSingle(solves) {
  const valid = solves.filter(v => v !== null && v !== undefined && v !== '' && Number(v) > 0);
  if (!valid.length) return -1;
  return Math.min(...valid.map(Number));
}

// ===========================
// UTILITY MESSAGES
// ===========================

// showPanelToast — shows a transient toast inside a panel message element
function showPanelToast(el, type, text) {
  el.style.animation = 'none';
  el.offsetHeight; // force reflow to restart animation
  el.className     = `msg panel-toast ${type}`;
  el.textContent   = text;
  el.style.display = 'block';
  el.style.animation = '';
  const dur = type === 'success' ? 2000 : 3500;
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => { el.style.display = 'none'; }, dur);
}

// showMsg — shows a persistent message that auto-hides after 5 seconds
function showMsg(el, type, text) {
  el.className     = `msg ${type}`;
  el.textContent   = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ===========================
// RESULTS ENTRY — PANEL BUILDING
// ===========================

// buildResultPanels — creates all compact entry panels in #resultPanels
function buildResultPanels() {
  const container = document.getElementById('resultPanels');
  container.innerHTML = '';

  for (let i = 0; i < numPanels; i++) {
    const panel = document.createElement('div');
    panel.className = 'compact-panel';
    panel.innerHTML = `
      <div class="compact-panel-header">
        <span class="compact-panel-title">Panel ${i + 1}</span>
        <div class="compact-panel-actions">
          ${i > 0 ? `<button type="button" class="btn-xs" id="copyBtn${i}" title="Copy event/round/group from panel above">Copy ↑</button>` : ''}
          <button type="button" class="btn-xs" id="clearBtn${i}">Clear</button>
        </div>
      </div>
      <select id="p${i}_athlete" class="compact-select">
        <option value="">— Athlete —</option>
      </select>
      <select id="p${i}_event" class="compact-select" disabled>
        <option value="">— Event —</option>
      </select>
      <div class="compact-rg-row">
        <select id="p${i}_round" class="compact-select" style="margin-bottom:0;"></select>
        <select id="p${i}_group" class="compact-select" style="margin-bottom:0;"></select>
      </div>
      <div class="compact-solves-row">
        ${[1,2,3,4,5].map(n => `
          <div class="solve-group">
            <span class="solve-label">S${n}</span>
            <input type="text" class="solve-input" id="solve${i}_${n}" placeholder="\u2014" autocomplete="off" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" />
            <div class="solve-btns">
              <button class="solve-btn solve-btn-plus2" id="plus2_${i}_${n}" type="button">+2</button>
              <button class="solve-btn solve-btn-dnf"   id="dnf_${i}_${n}"   type="button">DNF</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="compact-calc-row">
        <div class="calc-item">
          <div class="calc-label">Single</div>
          <div class="calc-value" id="calcSingle${i}">\u2014</div>
        </div>
        <div class="calc-item">
          <div class="calc-label">Average</div>
          <div class="calc-value accent" id="calcAvg${i}">\u2014</div>
        </div>
      </div>
      <button class="btn-sm-primary" style="width:100%;padding:0.4rem;" id="saveResBtn${i}" disabled>Save</button>
      <div class="msg" id="resPanelMsg${i}"></div>
    `;
    container.appendChild(panel);

    // Athlete change → rebuild events, then re-check eligibility
    panel.querySelector(`#p${i}_athlete`).addEventListener('change', () => { updatePanelEvents(i); checkPanelEligibility(i); });
    // Event change → rebuild round/group
    panel.querySelector(`#p${i}_event`).addEventListener('change', () => updatePanelRoundGroup(i));
    // Round change → re-filter athletes by eligibility
    panel.querySelector(`#p${i}_round`).addEventListener('change', () => refreshPanelAthletesByEligibility(i));

    // Solve inputs
    for (let n = 1; n <= 5; n++) {
      panel.querySelector(`#solve${i}_${n}`).addEventListener('input', function() {
        const v = this.value.trim().toUpperCase();
        this.classList.toggle('dnf-val', v === 'DNF' || v === 'DNS');
        document.getElementById(`plus2_${i}_${n}`).classList.toggle('active', v.endsWith('+'));
        document.getElementById(`dnf_${i}_${n}`).classList.toggle('active', v === 'DNF');
        updateCalc(i);
      });
      panel.querySelector(`#solve${i}_${n}`).addEventListener('blur', function() {
        formatSolveInput(this);
        const v = this.value.trim().toUpperCase();
        this.classList.toggle('dnf-val', v === 'DNF' || v === 'DNS');
        updateCalc(i);
      });
      panel.querySelector(`#plus2_${i}_${n}`).addEventListener('click', () => togglePlus2(i, n));
      panel.querySelector(`#dnf_${i}_${n}`).addEventListener('click',   () => toggleDnf(i, n));
      // Enter formats then advances to next solve field without triggering Save
      panel.querySelector(`#solve${i}_${n}`).addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        formatSolveInput(this);
        const v = this.value.trim().toUpperCase();
        this.classList.toggle('dnf-val', v === 'DNF' || v === 'DNS');
        updateCalc(i);
        const next = panel.querySelector(`#solve${i}_${n + 1}`);
        if (next) { next.focus(); next.select(); }
      });
    }

    panel.querySelector(`#saveResBtn${i}`).addEventListener('click', () => saveResult(i));
    panel.querySelector(`#clearBtn${i}`).addEventListener('click',   () => clearPanelFull(i));
    if (i > 0) panel.querySelector(`#copyBtn${i}`).addEventListener('click', () => copyPanelFrom(i));
  }
}

// ===========================
// togglePlus2 / toggleDnf
// ===========================
function togglePlus2(idx, n) {
  const inp = document.getElementById(`solve${idx}_${n}`);
  const btn = document.getElementById(`plus2_${idx}_${n}`);
  const v   = inp.value.trim();
  if (!v || v.toUpperCase() === 'DNF' || v.toUpperCase() === 'DNS') return;
  if (v.endsWith('+')) {
    inp.value = v.slice(0, -1);
    btn.classList.remove('active');
  } else {
    inp.value = v + '+';
    btn.classList.add('active');
  }
  inp.classList.remove('dnf-val');
  updateCalc(idx);
}

function toggleDnf(idx, n) {
  const inp     = document.getElementById(`solve${idx}_${n}`);
  const btnDnf  = document.getElementById(`dnf_${idx}_${n}`);
  const btnPlus = document.getElementById(`plus2_${idx}_${n}`);
  if (inp.value.trim().toUpperCase() === 'DNF') {
    inp.value = '';
    btnDnf.classList.remove('active');
    inp.classList.remove('dnf-val');
  } else {
    inp.value = 'DNF';
    btnDnf.classList.add('active');
    btnPlus.classList.remove('active');
    inp.classList.add('dnf-val');
  }
  updateCalc(idx);
}

// ===========================
// clearPanel / clearPanelFull
// ===========================

// clearPanel — clears solve inputs and resets athlete selection for a panel
function clearPanel(idx) {
  if (!panelState[idx]) return;
  panelState[idx].selectedAthlete = null;
  const acInp  = document.getElementById(`acInput${idx}`);
  const acInfo = document.getElementById(`selAthlInfo${idx}`);
  if (acInp)  acInp.value = '';
  if (acInfo) acInfo.style.display = 'none';
  for (let n = 1; n <= 5; n++) {
    const inp = document.getElementById(`solve${idx}_${n}`);
    if (!inp) continue;
    inp.value = '';
    inp.classList.remove('dnf-val');
    document.getElementById(`plus2_${idx}_${n}`).classList.remove('active');
    document.getElementById(`dnf_${idx}_${n}`).classList.remove('active');
  }
  const singleEl = document.getElementById(`calcSingle${idx}`);
  const avgEl    = document.getElementById(`calcAvg${idx}`);
  if (singleEl) { singleEl.textContent = '\u2014'; singleEl.className = 'calc-value'; }
  if (avgEl)    { avgEl.textContent    = '\u2014'; avgEl.className    = 'calc-value accent'; }
  const msgEl = document.getElementById(`resPanelMsg${idx}`);
  if (msgEl) msgEl.style.display = 'none';
}

// clearPanelFull — resets athlete + event dropdowns and clears solves
function clearPanelFull(idx) {
  const athlSel = document.getElementById(`p${idx}_athlete`);
  const evSel   = document.getElementById(`p${idx}_event`);
  if (athlSel) athlSel.value = '';
  if (evSel)   { evSel.innerHTML = '<option value="">— Event —</option>'; evSel.disabled = true; }
  updatePanelRoundGroup(idx);
  clearPanel(idx);
  syncSaveBtn(idx);
}

// ===========================
// getSolves / updateCalc / allSolvesFilled / syncSaveBtn
// ===========================

// getSolves — reads solve input values and returns centiseconds array (nulls for empty)
function getSolves(idx) {
  const solves = [];
  for (let n = 1; n <= 5; n++) {
    const v = document.getElementById(`solve${idx}_${n}`).value.trim();
    solves.push(v ? parseTime(v) : null);
  }
  return solves;
}

// updateCalc — recalculates and displays Single + Average for a panel
function updateCalc(idx) {
  const solves = getSolves(idx);
  const validSolves = solves.filter(v => v !== null);
  const single = bestSingle(validSolves);
  const avg    = calcAo5(validSolves);

  const singleEl = document.getElementById(`calcSingle${idx}`);
  const avgEl    = document.getElementById(`calcAvg${idx}`);

  singleEl.textContent = (single !== undefined && single !== null) ? fmtTime(single) : '\u2014';
  singleEl.className   = 'calc-value';

  if (avg === null) {
    avgEl.textContent = '\u2014';
    avgEl.className   = 'calc-value accent';
  } else if (avg === -1) {
    avgEl.textContent = 'DNF';
    avgEl.className   = 'calc-value dnf';
  } else {
    avgEl.textContent = fmtTime(avg);
    avgEl.className   = 'calc-value accent';
  }

  syncSaveBtn(idx);
}

// allSolvesFilled — returns true only if all 5 solve inputs have a value
function allSolvesFilled(idx) {
  for (let n = 1; n <= 5; n++) {
    const inp = document.getElementById(`solve${idx}_${n}`);
    if (!inp || inp.value.trim() === '') return false;
  }
  return true;
}

// syncSaveBtn — enables/disables Save button based on eligibility + completeness
function syncSaveBtn(idx) {
  const saveBtn = document.getElementById(`saveResBtn${idx}`);
  if (!saveBtn) return;
  const msgEl = document.getElementById(`resPanelMsg${idx}`);
  const ineligible = msgEl && msgEl.classList.contains('warn') && msgEl.style.display !== 'none';
  saveBtn.disabled = ineligible || !allSolvesFilled(idx);
}

// ===========================
// saveResult
// ===========================
async function saveResult(idx) {
  const msg       = document.getElementById(`resPanelMsg${idx}`);
  const compId    = document.getElementById('resComp').value;
  const athlDocId = document.getElementById(`p${idx}_athlete`).value;
  const eventId   = document.getElementById(`p${idx}_event`).value;
  const round     = parseInt(document.getElementById(`p${idx}_round`).value) || 1;
  const group     = document.getElementById(`p${idx}_group`).value;
  const athl      = athlDocId ? athletesCache.find(a => a.id === athlDocId) : null;

  if (!athl)    { showMsg(msg, 'error', 'Select an athlete first.'); return; }
  if (!compId)  { showMsg(msg, 'error', 'Select a competition.'); return; }
  if (!eventId) { showMsg(msg, 'error', 'Select an event.'); return; }

  // Round progression check
  if (round > 1) {
    const _eligStatus = athleteEligibilityStatus(compId, athl.id, eventId, round);
    if (_eligStatus !== 'ok') {
      const compObj   = competitionsCache.find(c => c.id === compId);
      const evData2   = compObj && compObj.events && compObj.events[eventId];
      const totalRnds = evData2 ? (parseInt(evData2.rounds) || 1) : round;
      const rNames    = getRoundNames(totalRnds);
      const roundName = rNames[round - 1] || `Round ${round}`;
      const prevName  = rNames[round - 2] || `Round ${round - 1}`;
      const errMsg    = _eligStatus === 'not_qualified'
        ? `${athl.name} did not qualify from ${prevName} and cannot enter ${roundName}.`
        : `${athl.name} cannot enter ${roundName} — ${prevName} result is missing.`;
      showMsg(msg, 'error', errMsg);
      return;
    }
  }

  const solves = getSolves(idx);
  if (solves.every(v => v === null)) { showMsg(msg, 'error', 'Enter at least one solve.'); return; }

  const comp        = competitionsCache.find(c => c.id === compId);
  const evDef       = WCA_EVENTS.find(e => e.id === eventId);
  const validSolves = solves.filter(v => v !== null);
  const single      = bestSingle(validSolves);
  const average     = calcAo5(validSolves);

  // Duplicate check — block if athlete already has a result in this event+round (any group)
  try {
    const existSnap = await window.db.collection('results')
      .where('competitionId', '==', compId)
      .get();
    const dup = existSnap.docs.find(d => {
      const r = d.data();
      return r.athleteId === athl.id && r.eventId === eventId && r.round === round;
    });
    if (dup) {
      showMsg(msg, 'error', `${athl.name} already has a result in this round. Edit the existing entry instead.`);
      return;
    }
  } catch(_) { /* proceed on error */ }

  try {
    await window.db.collection('results').add({
      competitionId:   compId,
      competitionName: comp ? comp.name : '',
      athleteId:       athl.id,
      athleteName:     athl.name,
      eventId,
      eventName:  evDef ? evDef.name : eventId,
      round,
      group,
      solves,
      single:  single  !== undefined ? single  : null,
      average: average !== undefined ? average : null,
      dnf:    validSolves.some(v => v === -1),
      dns:    validSolves.some(v => v === -2),
      status: 'draft',
      source: 'club',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showPanelToast(msg, 'success', typeof t === 'function' ? t('result.saved') : 'Saved!');
    clearPanel(idx);
  } catch(e) {
    showPanelToast(msg, 'error', typeof t === 'function' ? t('result.save-failed') : 'Save failed.');
  }
}

// ===========================
// PER-PANEL SELECTORS
// ===========================

// updatePanelAthletes — rebuilds athlete dropdown for panel idx based on selected competition
function updatePanelAthletes(idx) {
  const compId = document.getElementById('resComp').value;
  const sel    = document.getElementById(`p${idx}_athlete`);
  if (!sel) return;
  const prev   = sel.value;
  sel.innerHTML = '<option value="">— Athlete —</option>';
  if (!compId) { sel.disabled = true; updatePanelEvents(idx); return; }
  const comp    = competitionsCache.find(c => c.id === compId);
  const athlIds = comp ? (comp.athleteIds || []) : [];
  const pool    = athletesCache.filter(a => athlIds.includes(a.id));
  pool.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name + (a.lastName ? ' ' + a.lastName : '') + (a.wcaId ? ` (${a.wcaId})` : '');
    if (a.id === prev) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.disabled = !pool.length;
  updatePanelEvents(idx);
}

// updateAllPanelAthletes — calls updatePanelAthletes for all panels
function updateAllPanelAthletes() {
  for (let i = 0; i < numPanels; i++) updatePanelAthletes(i);
}

// updatePanelEvents — rebuilds event dropdown for panel idx based on athlete + competition
function updatePanelEvents(idx) {
  const compId    = document.getElementById('resComp').value;
  const athlDocId = document.getElementById(`p${idx}_athlete`).value;
  const sel       = document.getElementById(`p${idx}_event`);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Event —</option>';
  if (!compId || !athlDocId) { sel.disabled = true; updatePanelRoundGroup(idx); return; }
  const comp = competitionsCache.find(c => c.id === compId);
  if (!comp || !comp.events) { sel.disabled = true; updatePanelRoundGroup(idx); return; }
  const evIds = (comp.athleteEvents && comp.athleteEvents[athlDocId])
    ? comp.athleteEvents[athlDocId]
    : Object.keys(comp.events);
  evIds.forEach(evId => {
    const evData = comp.events[evId];
    if (!evData) return;
    const opt = document.createElement('option');
    opt.value = evId;
    opt.textContent = evData.name || evId;
    if (evId === prev) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.disabled = false;
  updatePanelRoundGroup(idx);
}

// updatePanelRoundGroup — rebuilds round + group dropdowns for panel idx
function updatePanelRoundGroup(idx) {
  const compId  = document.getElementById('resComp').value;
  const eventId = document.getElementById(`p${idx}_event`).value;
  const roundSel = document.getElementById(`p${idx}_round`);
  const groupSel = document.getElementById(`p${idx}_group`);
  if (!roundSel || !groupSel) return;
  roundSel.innerHTML = '';
  groupSel.innerHTML = '';
  const comp   = competitionsCache.find(c => c.id === compId);
  const evData = comp && comp.events && eventId ? comp.events[eventId] : null;
  const rounds = evData ? (parseInt(evData.rounds) || 1) : 1;
  const rNames = getRoundNames(rounds);
  for (let r = 1; r <= rounds; r++) {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = rNames[r - 1] || `Round ${r}`;
    roundSel.appendChild(opt);
  }
  const rawGroups = evData ? (evData.groups || '') : '';
  let groups;
  if (Array.isArray(rawGroups)) {
    groups = rawGroups.length ? rawGroups : ['A'];
  } else {
    const str = rawGroups.trim().toUpperCase();
    if (str.length === 1 && str >= 'A' && str <= 'Z') {
      groups = [];
      for (let c = 'A'.charCodeAt(0); c <= str.charCodeAt(0); c++) groups.push(String.fromCharCode(c));
    } else {
      groups = str ? str.split(/\s+/) : ['A'];
    }
  }
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = `Group ${g}`;
    groupSel.appendChild(opt);
  });
  refreshPanelAthletesByEligibility(idx);
}

// ===========================
// ROUND PROGRESSION VALIDATION
// ===========================

// athleteEligibilityStatus — returns 'ok' | 'no_result' | 'not_qualified'
function athleteEligibilityStatus(compId, athlId, eventId, targetRound) {
  if (targetRound <= 1) return 'ok';
  const hasResult = allAdminResults.some(r =>
    r.competitionId === compId && r.athleteId === athlId &&
    r.eventId === eventId && (r.round || 1) === targetRound - 1
  );
  if (!hasResult) return 'no_result';
  const comp = competitionsCache.find(c => c.id === compId);
  const qualSet = computeQualifiedSet(compId, eventId, targetRound - 1, allAdminResults, comp);
  if (!qualSet) return 'ok'; // no advancement rule — having a result is sufficient
  return qualSet.ids.has(athlId) ? 'ok' : 'not_qualified';
}

// athleteEligibleForRound — shorthand boolean check
function athleteEligibleForRound(compId, athlId, eventId, targetRound) {
  return athleteEligibilityStatus(compId, athlId, eventId, targetRound) === 'ok';
}

// checkPanelEligibility — shows/hides eligibility warning and enables/disables Save button
function checkPanelEligibility(idx) {
  const compId    = document.getElementById('resComp').value;
  const athlDocId = document.getElementById(`p${idx}_athlete`).value;
  const eventId   = document.getElementById(`p${idx}_event`).value;
  const round     = parseInt(document.getElementById(`p${idx}_round`).value) || 1;
  const saveBtn   = document.getElementById(`saveResBtn${idx}`);
  const msgEl     = document.getElementById(`resPanelMsg${idx}`);

  if (!athlDocId || !eventId || round <= 1) {
    if (msgEl && msgEl.classList.contains('warn')) msgEl.style.display = 'none';
    syncSaveBtn(idx);
    return true;
  }

  const comp      = competitionsCache.find(c => c.id === compId);
  const evData    = comp && comp.events && comp.events[eventId];
  const totalRnds = evData ? (parseInt(evData.rounds) || 1) : round;
  const rNames    = getRoundNames(totalRnds);
  const roundName = rNames[round - 1] || `Round ${round}`;
  const prevName  = rNames[round - 2] || `Round ${round - 1}`;

  const eligStatus = athleteEligibilityStatus(compId, athlDocId, eventId, round);
  if (eligStatus !== 'ok') {
    if (msgEl) {
      msgEl.className   = 'msg warn';
      msgEl.textContent = eligStatus === 'not_qualified'
        ? `Cannot enter ${roundName} — this athlete did not qualify from ${prevName}.`
        : `Cannot enter ${roundName} yet — ${prevName} result is missing.`;
      msgEl.style.display = 'block';
    }
    if (saveBtn) saveBtn.disabled = true;
    return false;
  }
  if (msgEl && msgEl.classList.contains('warn')) msgEl.style.display = 'none';
  syncSaveBtn(idx);
  return true;
}

// refreshPanelAthletesByEligibility — rebuilds athlete dropdown, greys out ineligible athletes for round > 1
function refreshPanelAthletesByEligibility(idx) {
  const compId  = document.getElementById('resComp').value;
  const eventId = document.getElementById(`p${idx}_event`).value;
  const round   = parseInt(document.getElementById(`p${idx}_round`).value) || 1;
  const sel     = document.getElementById(`p${idx}_athlete`);
  if (!sel) return;

  if (round <= 1 || !eventId) { checkPanelEligibility(idx); return; }

  const prevVal = sel.value;
  const comp    = compId ? competitionsCache.find(c => c.id === compId) : null;
  const athlIds = comp ? (comp.athleteIds || []) : [];
  const pool    = athletesCache.filter(a => athlIds.includes(a.id));

  sel.innerHTML = '<option value="">— Athlete —</option>';
  pool.forEach(a => {
    const eligible = athleteEligibleForRound(compId, a.id, eventId, round);
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name + (a.lastName ? ' ' + a.lastName : '') +
      (a.wcaId ? ` (${a.wcaId})` : '');
    opt.disabled = !eligible;
    if (!eligible) opt.style.color = 'var(--muted)';
    if (a.id === prevVal) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.disabled = !pool.length;
  checkPanelEligibility(idx);
}

// ===========================
// copyPanelFrom
// ===========================
// Copies event/round/group selection from the panel above (idx - 1) to panel idx
function copyPanelFrom(idx) {
  if (idx < 1) return;
  const prev    = idx - 1;
  const prevEv  = document.getElementById(`p${prev}_event`).value;
  const prevRd  = document.getElementById(`p${prev}_round`).value;
  const prevGrp = document.getElementById(`p${prev}_group`).value;
  if (!prevEv) return;
  const evSel = document.getElementById(`p${idx}_event`);
  if (evSel.querySelector(`option[value="${prevEv}"]`)) {
    evSel.value = prevEv;
    updatePanelRoundGroup(idx);
    const rdSel  = document.getElementById(`p${idx}_round`);
    const grpSel = document.getElementById(`p${idx}_group`);
    if (rdSel.querySelector(`option[value="${prevRd}"]`))   rdSel.value  = prevRd;
    if (grpSel.querySelector(`option[value="${prevGrp}"]`)) grpSel.value = prevGrp;
  }
}

// ===========================
// refreshResultsCompDropdown
// ===========================
// Rebuilds the #resComp <select> from competitionsCache (live first)
function refreshResultsCompDropdown() {
  const sel  = document.getElementById('resComp');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select Competition —</option>';

  const order = { live: 0, upcoming: 1, finished: 2 };
  const sorted = [...competitionsCache].sort((a, b) =>
    (order[a.status] ?? 2) - (order[b.status] ?? 2));

  sorted.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.status})`;
    if (c.id === prev) opt.selected = true;
    sel.appendChild(opt);
  });
  updateAllPanelAthletes();
  try { updateEntryPanelVisibility(); } catch(_) {}
}

// ===========================
// updateEntryPanelVisibility / updatePanelGridCols / updatePanelControls
// ===========================

// updateEntryPanelVisibility — shows/hides result panels based on whether a competition is selected
function updateEntryPanelVisibility() {
  const compId  = document.getElementById('resComp').value;
  const grid    = document.getElementById('resultPanels');
  const prompt  = document.getElementById('entrySelectPrompt');
  const ctrl    = document.getElementById('panelControls');
  if (!grid) return;
  if (compId) {
    grid.style.display = 'grid';
    if (prompt) prompt.style.display = 'none';
    if (ctrl)  ctrl.style.display = 'flex';
    updatePanelGridCols();
    updatePanelControls();
  } else {
    grid.style.display = 'none';
    if (prompt) prompt.style.display = 'block';
    if (ctrl)  ctrl.style.display = 'none';
  }
}

// updatePanelGridCols — sets CSS grid columns for the panels container
function updatePanelGridCols() {
  const grid = document.getElementById('resultPanels');
  if (!grid) return;
  const cols = numPanels === 1 ? 1 : numPanels <= 3 ? numPanels : numPanels === 4 ? 2 : 3;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

// updatePanelControls — updates the panel count label and +/- button disabled states
function updatePanelControls() {
  const ctrl    = document.getElementById('panelControls');
  const label   = document.getElementById('panelCountLabel');
  const addBtn  = document.getElementById('addPanelBtn');
  const remBtn  = document.getElementById('removePanelBtn');
  if (!ctrl) return;
  if (label) label.textContent = numPanels;
  if (addBtn) addBtn.disabled = numPanels >= 6;
  if (remBtn) remBtn.disabled = numPanels <= 1;
}

// ===========================
// addPanel / removePanel
// ===========================
function addPanel() {
  if (numPanels >= 6) return;
  numPanels++;
  panelState.push({ selectedAthlete: null });
  buildResultPanels();
  updatePanelGridCols();
  updatePanelControls();
  updateAllPanelAthletes();
}

function removePanel() {
  if (numPanels <= 1) return;
  numPanels--;
  panelState.pop();
  buildResultPanels();
  updatePanelGridCols();
  updatePanelControls();
  updateAllPanelAthletes();
}

// ===========================
// COMPETITION RESULTS FEED
// ===========================

// startCompResultsFeed — subscribes to all results from Firestore (live listener)
function startCompResultsFeed() {
  if (unsubCompResults) return; // already listening
  unsubCompResults = window.db.collection('results').onSnapshot(snap => {
    allAdminResults = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Only render the Competition Results tab when it's actually active
    const crTabEl = document.getElementById('tabCompResults');
    if (crTabEl && crTabEl.classList.contains('active')) renderCompResultsTab();
    // Refresh eligibility in Results Entry panels (a saved result may unlock the next round)
    for (let _pi = 0; _pi < numPanels; _pi++) {
      if (document.getElementById(`p${_pi}_athlete`)) refreshPanelAthletesByEligibility(_pi);
    }
  }, err => {
    const wrap = document.getElementById('compResultsWrap');
    if (wrap) wrap.innerHTML =
      `<div class="wca-empty" style="color:#f43f5e;">Error: ${escHtml(err.message)}</div>`;
  });
}

// ===========================
// renderCompResultsTab
// ===========================
// Rebuilds the competition selector in the WCA Live sidebar and triggers crUpdateSidebar + crRenderTable
function renderCompResultsTab() {
  const crSel = document.getElementById('crCompSel');
  if (!crSel) return;

  const compsWithResults = [];
  competitionsCache.forEach(c => {
    if (allAdminResults.some(r => r.competitionId === c.id)) compsWithResults.push(c);
  });
  // Also include comps from results that may not be in cache
  allAdminResults.forEach(r => {
    if (r.competitionId && !compsWithResults.find(c => c.id === r.competitionId))
      compsWithResults.push({ id: r.competitionId, name: r.competitionName || r.competitionId });
  });

  const prevSel = crSel.value;
  crSel.innerHTML = '<option value="">— Competition —</option>';
  compsWithResults.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || c.id;
    if (c.id === (crCompId || prevSel)) opt.selected = true;
    crSel.appendChild(opt);
  });

  // Auto-select first if nothing selected
  if (!crCompId && compsWithResults.length) {
    crCompId = compsWithResults[0].id;
    crSel.value = crCompId;
  }

  crUpdateSidebar();
  crRenderTable();
}

// ===========================
// crUpdateSidebar
// ===========================
// Rebuilds the event list in the WCA Live sidebar
function crUpdateSidebar() {
  const eventList = document.getElementById('crEventList');
  if (!eventList) return;

  const comp = competitionsCache.find(c => c.id === crCompId);
  const evMap = {};
  if (comp && comp.events) {
    Object.entries(comp.events).forEach(([evId, evData]) => {
      evMap[evId] = evData.name || evId;
    });
  }
  // Fallback: events from existing results
  allAdminResults.filter(r => r.competitionId === crCompId).forEach(r => {
    if (!evMap[r.eventId]) evMap[r.eventId] = r.eventName || r.eventId;
  });

  // Order by WCA_EVENTS order
  const evIds = WCA_EVENTS.filter(e => evMap[e.id]).map(e => e.id);
  Object.keys(evMap).forEach(id => { if (!evIds.includes(id)) evIds.push(id); });

  if (!evIds.length) {
    eventList.innerHTML = '<div style="padding:0.9rem 0.85rem;color:var(--muted);font-size:0.8rem;">No events defined.</div>';
    return;
  }

  // Auto-select first event if none selected or current not in list
  if (!crEvId || !evIds.includes(crEvId)) { crEvId = evIds[0]; crRound = 1; crGroup = null; }

  eventList.innerHTML = evIds.map(evId => {
    const evDef  = WCA_EVENTS.find(e => e.id === evId);
    const short  = evDef ? evDef.short : evId.toUpperCase();
    const name   = evMap[evId] || evId;
    const active = evId === crEvId ? ' active' : '';
    return `<div class="wca-event-item${active}" onclick="crSelectEvent('${escHtml(evId)}')">
      <span class="wca-event-short">${escHtml(short)}</span>
      <span>${escHtml(name)}</span>
    </div>`;
  }).join('');
}

// ===========================
// crSelectComp / crSelectEvent / crSelectRound
// ===========================
function crSelectComp(id) {
  crCompId = id || null;
  crEvId   = null;
  crRound  = 1;
  crGroup  = null;
  crUpdateSidebar();
  crRenderTable();
  if (crCompId) crLoadRoundCompletions(crCompId);
}

function crSelectEvent(evId) {
  crEvId  = evId;
  crRound = 1;
  crGroup = null;
  crUpdateSidebar();
  crRenderTable();
}

function crSelectRound(rd) {
  crRound = rd;
  crGroup = null;
  crRenderTable();
}

function crSelectGroup(grp) {
  crGroup = grp;
  crRenderTable();
}

// ===========================
// crLoadRoundCompletions / crIsRoundComplete / crToggleRoundComplete
// ===========================
var _roundCompletionsCache = {}; // compId -> { "evId_round": { completed, completedAt } }

async function crLoadRoundCompletions(compId) {
  if (!compId) return;
  try {
    const snap = await window.db.collection('roundCompletions').doc(compId).get();
    _roundCompletionsCache[compId] = snap.exists ? (snap.data() || {}) : {};
  } catch(e) { _roundCompletionsCache[compId] = {}; }
  crRenderTable();
}

function crIsRoundComplete(compId, evId, round) {
  const data = _roundCompletionsCache[compId] || {};
  const v = data[evId + '_' + round];
  return !!(v && v.completed);
}

async function crToggleRoundComplete(compId, evId, round) {
  if (!_roundCompletionsCache[compId]) _roundCompletionsCache[compId] = {};
  const data = _roundCompletionsCache[compId];
  const key = evId + '_' + round;
  const cur = data[key] && data[key].completed;
  data[key] = { completed: !cur, completedAt: !cur ? new Date().toISOString() : null };
  const btn = document.getElementById('crRoundCompleteArea') &&
    document.getElementById('crRoundCompleteArea').querySelector('.cr-complete-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await window.db.collection('roundCompletions').doc(compId).set(data);
  } catch(e) { console.error('crToggleRoundComplete error:', e); }
  crRenderTable();
}

// ===========================
// computeQualifiedSet
// ===========================
// Returns { ids: Set<athleteId>, names: Set<normalizedName>, cutoff, total }
// or null if no advancement rule configured for this transition.
function computeQualifiedSet(compId, evId, fromRound, results, comp) {
  const evData = comp && comp.events && comp.events[evId];
  const adv = evData && evData.advancement && evData.advancement[String(fromRound)];
  if (!adv || adv.type === 'none' || !adv.value) return null;

  const prev = results.filter(r =>
    r.competitionId === compId && r.eventId === evId && (r.round || 1) === fromRound
  );
  const ranked = prev.slice().sort((a, b) => {
    const aA = a.average, bA = b.average;
    if (aA === -1 && bA === -1) return (a.single||0)-(b.single||0);
    if (aA === -1) return 1; if (bA === -1) return -1;
    if (aA === null && bA === null) return (a.single||0)-(b.single||0);
    if (aA === null) return 1; if (bA === null) return -1;
    return aA - bA;
  });

  let cutoff;
  if (adv.type === 'count')   cutoff = adv.value;
  else if (adv.type === 'percent') cutoff = Math.max(1, Math.floor(ranked.length * adv.value / 100));
  else return null;

  const ids   = new Set();
  const names = new Set();
  ranked.slice(0, cutoff).forEach(r => {
    if (r.athleteId) ids.add(r.athleteId);
    if (r.athleteName) names.add(r.athleteName.trim().toLowerCase());
  });
  return { ids, names, cutoff, total: ranked.length };
}

// isQualifiedForRound — checks if a result row is in the qualified set
function isQualifiedForRound(r, qualSet) {
  if (!qualSet) return true;
  if (r.athleteId && qualSet.ids.has(r.athleteId)) return true;
  if (r.athleteName && qualSet.names.has(r.athleteName.trim().toLowerCase())) return true;
  return false;
}

// computeAdvancingCutoff — returns { cutoff, text } or null for the advancement rule for this round
function computeAdvancingCutoff(comp, evId, round, totalRows) {
  if (!comp || !comp.events || !comp.events[evId]) return null;
  const evData = comp.events[evId];
  if (round >= (parseInt(evData.rounds) || 1)) return null; // final round
  const adv = evData.advancement && evData.advancement[String(round)];
  if (!adv || adv.type === 'none' || !adv.value) return null;
  if (adv.type === 'count') return { cutoff: adv.value, text: `Top ${adv.value} advance to next round` };
  if (adv.type === 'percent') {
    const cut = Math.max(1, Math.floor(totalRows * adv.value / 100));
    return { cutoff: cut, text: `Top ${adv.value}% \u2014 ${cut} athlete${cut !== 1 ? 's' : ''} advance to next round` };
  }
  return null;
}

// ===========================
// crRenderTable
// ===========================
// Renders the full results table for the currently selected comp/event/round in the WCA Live layout
function crRenderTable() {
  const wrap       = document.getElementById('compResultsWrap');
  const titleEl    = document.getElementById('crCompTitle');
  const metaEl     = document.getElementById('crCompMeta');
  const headerAct  = document.getElementById('crHeaderActions');
  const roundBar   = document.getElementById('crEventRoundBar');
  const roundTitle = document.getElementById('crEventRoundTitle');
  const roundTabs  = document.getElementById('crRoundTabs');
  const groupTabs  = document.getElementById('crGroupTabs');
  if (!wrap) return;

  const comp = competitionsCache.find(c => c.id === crCompId);
  const compName = comp ? comp.name : (crCompId || 'Competition');
  if (titleEl) titleEl.textContent = compName;

  if (metaEl && comp) {
    const compResults = allAdminResults.filter(r => r.competitionId === crCompId);
    const drafts  = compResults.filter(r => r.status !== 'published').length;
    const pubs    = compResults.filter(r => r.status === 'published').length;
    metaEl.innerHTML = `${escHtml(comp.country || '')}${comp.date ? ' &bull; ' + escHtml(comp.date) : ''}
      &nbsp;<span class="badge-draft">${drafts} draft</span>
      &nbsp;<span class="badge-published">${pubs} published</span>`;
  }

  if (headerAct) {
    headerAct.innerHTML = crCompId
      ? `<button class="btn-publish" onclick="publishCompResults('${escHtml(crCompId)}')">&#10003; Publish All</button>`
      : '';
  }

  if (!crCompId || !crEvId) {
    if (roundBar) roundBar.style.display = 'none';
    if (groupTabs) groupTabs.style.display = 'none';
    wrap.innerHTML = '<div class="wca-empty">Select an event to view results.</div>';
    return;
  }

  const evResults = allAdminResults.filter(r => r.competitionId === crCompId && r.eventId === crEvId);
  const evDef = WCA_EVENTS.find(e => e.id === crEvId);
  const evName = evResults[0]?.eventName || evDef?.name || crEvId;

  // Distinct rounds — prefer comp definition
  const totalRounds = comp && comp.events && comp.events[crEvId]
    ? (parseInt(comp.events[crEvId].rounds) || 1)
    : null;
  const rounds = totalRounds
    ? Array.from({ length: totalRounds }, (_, i) => i + 1)
    : [...new Set(evResults.map(r => r.round || 1))].sort((a, b) => a - b);
  if (!rounds.includes(crRound)) crRound = rounds[0] || 1;

  const crRoundNames = getRoundNames(rounds.length);
  const roundLabel = crRoundNames[crRound - 1] || `Round ${crRound}`;
  if (roundBar)   roundBar.style.display = 'flex';
  if (roundTitle) roundTitle.textContent = `${evName} — ${roundLabel}`;

  if (roundTabs) {
    roundTabs.innerHTML = rounds.map(rd => {
      const rName = crRoundNames[rd - 1] || `Round ${rd}`;
      return `<button class="wca-round-tab${rd === crRound ? ' active' : ''}" onclick="crSelectRound(${rd})">${escHtml(rName)}</button>`;
    }).join('');
  }

  // Mark Round Complete button
  const completeArea = document.getElementById('crRoundCompleteArea');
  if (completeArea && crCompId && crEvId) {
    const isDone = crIsRoundComplete(crCompId, crEvId, crRound);
    completeArea.innerHTML = `<button class="cr-complete-btn ${isDone ? 'done' : 'not-done'}"
      onclick="crToggleRoundComplete('${escHtml(crCompId)}','${escHtml(crEvId)}',${crRound})"
      title="${isDone ? 'Click to unmark' : 'Mark this round as complete'}">
      ${isDone ? '&#10003; Round Complete' : 'Mark Complete'}
    </button>`;
  } else if (completeArea) {
    completeArea.innerHTML = '';
  }

  // Results for this round (no group filtering)
  const rdResults = evResults.filter(r => (r.round || 1) === crRound);
  if (groupTabs) groupTabs.style.display = 'none';
  const rows = rdResults;

  if (!rows.length) {
    wrap.innerHTML = '<div class="wca-empty">No results for this round yet.</div>';
    return;
  }

  // Detect duplicate athletes
  const _dupKeys = new Map();
  const _dupDocIds = new Set();
  const _dupAthlKeys = new Set();
  rows.forEach(r => {
    const key = r.athleteId ? ('id:' + r.athleteId) : ('name:' + (r.athleteName||'').trim().toLowerCase());
    if (_dupKeys.has(key)) { _dupDocIds.add(r.id); _dupDocIds.add(_dupKeys.get(key)); _dupAthlKeys.add(key); }
    else _dupKeys.set(key, r.id);
  });

  // Sort: average ascending, DNF last, then single
  const ranked = [...rows].sort((a, b) => {
    const aA = a.average, bA = b.average;
    if (aA === -1 && bA === -1) return (a.single||0)-(b.single||0);
    if (aA === -1) return 1; if (bA === -1) return -1;
    if (aA === null && bA === null) return (a.single||0)-(b.single||0);
    if (aA === null) return 1; if (bA === null) return -1;
    return aA - bA;
  });

  const _advResult = computeAdvancingCutoff(comp, crEvId, crRound, ranked.length);
  const _advCutoff = _advResult ? _advResult.cutoff : null;
  const _qualSet   = crRound > 1 ? computeQualifiedSet(crCompId, crEvId, crRound - 1, allAdminResults, comp) : null;

  const tbodyRows = ranked.map((r, idx) => {
    const rank = idx + 1;
    const isImportedRow = r.source === 'imported';
    const isDup = _dupDocIds.has(r.id);
    const isAdv = _advCutoff !== null && rank <= _advCutoff;
    const isNonQual = _qualSet !== null && !isQualifiedForRound(r, _qualSet);
    const podiumCls = rank === 1 ? ' row-gold' : rank === 2 ? ' row-silver' : rank === 3 ? ' row-bronze' : '';
    const sourceCls = isImportedRow ? ' row-imported' : (podiumCls ? '' : ' row-club');
    const dupCls    = isDup      ? ' row-dup-flag'   : '';
    const advCls    = isAdv     ? ' row-advancing'  : '';
    const nqCls     = isNonQual ? ' row-nonqualified' : '';
    const rowCls    = podiumCls + sourceCls + dupCls + advCls + nqCls;
    const rankCls = rank === 1 ? ' wca-rank-1' : rank === 2 ? ' wca-rank-2' : rank === 3 ? ' wca-rank-3' : '';

    const solves = (r.solves || [null,null,null,null,null]).slice(0, 5);
    while (solves.length < 5) solves.push(null);

    let bestVal = null, bestIdx = -1;
    solves.forEach((s, i) => {
      if (s !== null && s !== -1 && s !== -2) {
        if (bestVal === null || s < bestVal) { bestVal = s; bestIdx = i; }
      }
    });

    const solveCells = solves.map((s, i) => {
      const isBest = (i === bestIdx);
      const isDnf  = (s === -1 || s === -2);
      let cls = 'wca-td-solve';
      if (isBest) cls += ' best-solve';
      if (isDnf)  cls += ' dnf-solve';
      return `<td class="${cls}">${escHtml(fmtTime(s))}</td>`;
    }).join('');

    const avgCls     = r.average === -1 ? ' dnf-avg' : '';
    const isImported = r.source === 'imported';
    const badge      = isImported
      ? `<span class="badge-imported">imported</span>`
      : r.status === 'published'
        ? `<span class="badge-published" style="font-size:0.65rem;">pub</span>`
        : `<span class="badge-draft" style="font-size:0.65rem;">draft</span>`;
    const nameEsc  = escHtml((r.athleteName||'').replace(/'/g,"\\'"));
    const dupBadge = isDup      ? `<span class="badge-dup-warn" title="Duplicate entry">&#9888; dup</span>` : '';
    const nqBadge  = isNonQual ? `<span class="badge-nonqual" title="Did not qualify from previous round">&#9888; not qualified</span>` : '';
    const rowActions = `<button class="btn-edit" onclick="startEditResult('${escHtml(r.id)}')">Edit</button>
         <button class="btn-delete" onclick="deleteResult('${escHtml(r.id)}','${nameEsc}')">Del</button>`;

    return `<tr class="${rowCls} wca-fade-in">
      <td class="wca-td-rank${rankCls}">${rank}</td>
      <td class="wca-td-name">
        <div class="wca-name">${escHtml(r.athleteName||'—')}</div>
        ${r.country ? `<div class="wca-country">${escHtml(r.country)}</div>` : ''}
      </td>
      ${solveCells}
      <td class="wca-td-avg${avgCls}">${escHtml(fmtTime(r.average))}</td>
      <td class="wca-td-best">${escHtml(fmtTime(r.single))}</td>
      <td>${nqBadge || dupBadge || badge}</td>
      <td><div class="wca-row-actions">${rowActions}</div></td>
    </tr>`;
  });

  // Insert cutoff separator after last advancing row
  if (_advCutoff !== null && _advCutoff > 0 && _advCutoff < tbodyRows.length) {
    tbodyRows.splice(_advCutoff, 0, `<tr class="adv-cutoff-row"><td colspan="11"></td></tr>`);
  }
  const tbody = tbodyRows.join('');

  const _nqCount = ranked.filter(r => _qualSet !== null && !isQualifiedForRound(r, _qualSet)).length;
  const dupWarningHtml = _dupDocIds.size
    ? `<div class="dup-warning-banner">&#9888; Duplicate entries detected — ${_dupAthlKeys.size} athlete(s) appear more than once in this round. Delete the extra rows to fix.</div>`
    : '';
  const nqWarningHtml = _nqCount
    ? `<div class="dup-warning-banner" style="border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);color:#f87171;">&#9888; ${_nqCount} athlete(s) in this round did not qualify from the previous round. Delete their entries.</div>`
    : '';
  const advTextHtml = _advResult
    ? `<div class="adv-rule-text">&#10003; ${escHtml(_advResult.text)}</div>`
    : '';

  wrap.innerHTML = nqWarningHtml + dupWarningHtml + advTextHtml + `<table class="wca-results-table">
    <thead><tr>
      <th>#</th>
      <th>Athlete</th>
      <th class="th-r">1</th><th class="th-r">2</th><th class="th-r">3</th><th class="th-r">4</th><th class="th-r">5</th>
      <th class="th-r">Average</th>
      <th class="th-r">Best</th>
      <th>Status</th>
      <th></th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`;
}

// ===========================
// INLINE RESULT EDIT (Edit Result Card in tabCompResults)
// ===========================

// startEditResult — opens the edit card for a result by docId
function startEditResult(docId) {
  const r = allAdminResults.find(x => x.id === docId);
  if (!r) return;
  editingResultDocId = docId;

  const impFields = document.getElementById('erImportedFields');
  if (r.source === 'imported') {
    document.getElementById('erImportedName').value    = r.athleteName || '';
    document.getElementById('erImportedCountry').value = r.country     || '';
    impFields.style.display = 'block';
  } else {
    impFields.style.display = 'none';
  }

  document.getElementById('erAthlName').textContent  = r.athleteName || '';
  const erComp       = competitionsCache.find(c => c.id === r.competitionId);
  const erEvData     = erComp && erComp.events && r.eventId ? erComp.events[r.eventId] : null;
  const erTotalRnds  = erEvData ? (parseInt(erEvData.rounds) || 1) : (r.round || 1);
  const erRoundNames = getRoundNames(erTotalRnds);
  const erRoundLabel = erRoundNames[(r.round || 1) - 1] || `Round ${r.round || 1}`;
  document.getElementById('erEventName').textContent =
    (r.eventName || r.eventId || '') +
    ' — ' + erRoundLabel + ',  Group ' + (r.group || 'A');

  const solves = r.solves || [null,null,null,null,null];
  for (let n = 1; n <= 5; n++) {
    const sv  = solves[n - 1];
    const inp = document.getElementById(`er_solve_${n}`);
    let val = '';
    if (sv === -1) val = 'DNF';
    else if (sv === -2) val = 'DNS';
    else if (sv !== null && sv !== undefined) val = fmtTime(sv);
    inp.value = val;
    inp.classList.toggle('dnf-val', sv === -1 || sv === -2);
    document.getElementById(`er_plus2_${n}`).classList.remove('active');
    document.getElementById(`er_dnf_${n}`).classList.toggle('active', sv === -1);
  }

  updateErCalc();
  const card = document.getElementById('editResultCard');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// erSyncInput — syncs button states and recalculates when an edit-card solve input changes
function erSyncInput(n) {
  const v = document.getElementById(`er_solve_${n}`).value.trim().toUpperCase();
  document.getElementById(`er_solve_${n}`).classList.toggle('dnf-val', v === 'DNF' || v === 'DNS');
  document.getElementById(`er_plus2_${n}`).classList.toggle('active', v.endsWith('+'));
  document.getElementById(`er_dnf_${n}`).classList.toggle('active', v === 'DNF');
  updateErCalc();
}

// erTogglePlus2 — toggles +2 penalty on edit-card solve n
function erTogglePlus2(n) {
  const inp = document.getElementById(`er_solve_${n}`);
  const btn = document.getElementById(`er_plus2_${n}`);
  const v   = inp.value.trim();
  if (!v || v.toUpperCase() === 'DNF' || v.toUpperCase() === 'DNS') return;
  if (v.endsWith('+')) { inp.value = v.slice(0,-1); btn.classList.remove('active'); }
  else                 { inp.value = v + '+';        btn.classList.add('active'); }
  inp.classList.remove('dnf-val');
  updateErCalc();
}

// erToggleDnf — toggles DNF on edit-card solve n
function erToggleDnf(n) {
  const inp = document.getElementById(`er_solve_${n}`);
  const btn = document.getElementById(`er_dnf_${n}`);
  const p2  = document.getElementById(`er_plus2_${n}`);
  if (inp.value.trim().toUpperCase() === 'DNF') {
    inp.value = ''; btn.classList.remove('active'); inp.classList.remove('dnf-val');
  } else {
    inp.value = 'DNF'; btn.classList.add('active'); p2.classList.remove('active');
    inp.classList.add('dnf-val');
  }
  updateErCalc();
}

// getErSolves — reads edit-card solve inputs to centiseconds array
function getErSolves() {
  const solves = [];
  for (let n = 1; n <= 5; n++) {
    const v = document.getElementById(`er_solve_${n}`).value.trim();
    solves.push(v ? parseTime(v) : null);
  }
  return solves;
}

// updateErCalc — recalculates and displays Single + Average in the edit card
function updateErCalc() {
  const solves = getErSolves();
  const valid  = solves.filter(v => v !== null);
  const single = bestSingle(valid);
  const avg    = calcAo5(valid);
  const sEl    = document.getElementById('er_calcSingle');
  const aEl    = document.getElementById('er_calcAvg');
  sEl.textContent = (single !== undefined && single !== null) ? fmtTime(single) : '\u2014';
  sEl.className   = 'calc-value';
  if      (avg === null) { aEl.textContent = '\u2014'; aEl.className = 'calc-value accent'; }
  else if (avg === -1)   { aEl.textContent = 'DNF';    aEl.className = 'calc-value dnf'; }
  else                   { aEl.textContent = fmtTime(avg); aEl.className = 'calc-value accent'; }
}

// saveEditedResult — writes the edited solve data back to Firestore
async function saveEditedResult() {
  if (!editingResultDocId) return;
  const msg     = document.getElementById('erMsg');
  const solves  = getErSolves();
  const valid   = solves.filter(v => v !== null);
  const single  = bestSingle(valid);
  const average = calcAo5(valid);

  const r = allAdminResults.find(x => x.id === editingResultDocId);
  const updateData = {
    solves,
    single:  single  !== undefined ? single  : null,
    average: average !== undefined ? average : null,
    dnf: valid.some(v => v === -1),
    dns: valid.some(v => v === -2),
  };
  if (r && r.source === 'imported') {
    const nameVal    = document.getElementById('erImportedName').value.trim();
    const countryVal = document.getElementById('erImportedCountry').value.trim();
    if (nameVal) updateData.athleteName = nameVal;
    updateData.country = countryVal;
  }

  try {
    await window.db.collection('results').doc(editingResultDocId).update(updateData);
    showMsg(msg, 'success', 'Result updated.');
    cancelResultEdit();
  } catch(e) {
    showMsg(msg, 'error', 'Error: ' + e.message);
  }
}

// cancelResultEdit — hides the edit card and clears state
function cancelResultEdit() {
  editingResultDocId = null;
  document.getElementById('editResultCard').style.display = 'none';
}

// deleteResult — prompts and deletes a result document
function deleteResult(docId, name) {
  if (!confirm(`Delete result for "${name}"? This cannot be undone.`)) return;
  window.db.collection('results').doc(docId).delete()
    .catch(e => alert('Error: ' + e.message));
}

// ===========================
// INSPECTION TIMER
// ===========================
// Self-contained IIFE — exposes inspToggle, inspStart, inspStop, inspClear on window
(function() {
  var _inspInterval = null;
  var _inspStart    = 0;
  var _inspElapsed  = 0;   // centiseconds
  var _inspRunning  = false;

  function _inspUpdate() {
    _inspElapsed = Math.round((Date.now() - _inspStart) / 10);
    _inspDraw();
  }

  function _inspDraw() {
    var cs  = _inspElapsed;
    var sec = cs / 100;
    var timeEl   = document.getElementById('inspTime');
    var statusEl = document.getElementById('inspStatus');
    if (!timeEl) return;

    var disp = sec.toFixed(2);
    timeEl.textContent = disp;

    var state = 'normal', label = '', cls = '';
    if (sec >= 17) {
      state = 'dnf';   label = 'DNF';           cls = 'dnf';
      // Auto-stop at DNF
      if (_inspRunning) {
        _inspRunning = false;
        clearInterval(_inspInterval);
        _inspInterval = null;
        var sb = document.getElementById('inspStartBtn');
        var tb = document.getElementById('inspStopBtn');
        if (sb) sb.disabled = false;
        if (tb) tb.disabled = true;
      }
    } else if (sec >= 15) {
      state = 'plus2'; label = '+2 Penalty';    cls = 'plus2';
    } else if (sec >= 12) {
      state = 'warn2'; label = 'Final Warning'; cls = 'warn2';
    } else if (sec >= 8) {
      state = 'warn';  label = 'Warning';       cls = 'warn';
    }

    timeEl.className = 'insp-time' + (cls ? ' state-' + cls : '');
    statusEl.textContent  = label;
    statusEl.className    = 'insp-status' + (cls ? ' visible ' + cls : '');
  }

  window.inspToggle = function() {
    var box = document.getElementById('inspBox');
    var btn = document.getElementById('inspToggleBtn');
    var open = box.classList.toggle('visible');
    btn.classList.toggle('active', open);
  };

  window.inspStart = function() {
    if (_inspRunning) return;
    _inspRunning = true;
    _inspStart   = Date.now() - _inspElapsed * 10;
    _inspInterval = setInterval(_inspUpdate, 30);
    document.getElementById('inspStartBtn').disabled = true;
    document.getElementById('inspStopBtn').disabled  = false;
  };

  window.inspStop = function() {
    if (!_inspRunning) return;
    _inspRunning = false;
    clearInterval(_inspInterval);
    _inspInterval = null;
    document.getElementById('inspStartBtn').disabled = false;
    document.getElementById('inspStopBtn').disabled  = true;
  };

  window.inspClear = function() {
    window.inspStop();
    _inspElapsed = 0;
    _inspDraw();
    document.getElementById('inspStartBtn').disabled = false;
    document.getElementById('inspStopBtn').disabled  = true;
  };
})();

// ===========================
// Wire up the competition selector in WCA Live sidebar
// ===========================
// Call after DOM is ready:
// document.getElementById('crCompSel').addEventListener('change', () => crSelectComp(this.value));
// document.getElementById('resComp').addEventListener('change', () => {
//   updateAllPanelAthletes();
//   updateEntryPanelVisibility();
// });
