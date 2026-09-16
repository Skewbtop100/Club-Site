'use client';

// ── TEMP-IOS-RECORDING-DIAG: the log, readable on the phone ─────────────
// REMOVE WITH THE iOS RECORDING FIX, together with
// lib/online-competition/recording-diagnostics.ts.
//
// Safari on an iPhone has no console. The recorder writes its diagnostics
// into THIS DEVICE'S localStorage, and this page reads them back on the same
// device, where they can be copied or shared (Messages, Mail, Telegram…)
// from the share sheet. Nothing is sent anywhere by this page: the text
// leaves the phone only if the person holding it chooses to share it.
//
// Unlisted — nothing links here. It reads nothing but the local log.

import { useEffect, useState } from 'react';
import { clearRecDiag, readRecDiag, type RecDiagLine } from '@/lib/online-competition/recording-diagnostics';

function asText(lines: RecDiagLine[]): string {
  return lines
    .map((l) => `${l.at} +${l.t}ms ${l.event}${l.data === undefined ? '' : ` ${JSON.stringify(l.data)}`}`)
    .join('\n');
}

export default function RecordingDiagnosticsPage() {
  const [lines, setLines] = useState<RecDiagLine[]>([]);
  const [note, setNote] = useState('');

  const refresh = () => setLines(readRecDiag());
  useEffect(refresh, []);

  const text = asText(lines);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Хуулсан.');
    } catch {
      setNote('Хуулж чадсангүй — доорх текстийг удаан дарж сонгоно уу.');
    }
  }

  async function share() {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (!nav.share) {
      setNote('Энэ төхөөрөмж хуваалцах цонхгүй — ХУУЛАХ-г ашиглана уу.');
      return;
    }
    try {
      await nav.share({ title: 'Khorom recording log', text });
    } catch {
      /* the share sheet was dismissed */
    }
  }

  return (
    <main style={{ padding: '16px', color: '#F4F1EA', background: '#0A0A0C', minHeight: '100dvh' }}>
      <h1 style={{ font: '600 16px var(--oc-font-heading), sans-serif', marginBottom: 6 }}>Бичлэгийн оношилгоо</h1>
      <p style={{ font: '400 12px/18px var(--oc-font-heading), sans-serif', color: '#9A958A', marginBottom: 12 }}>
        {lines.length} мөр. Энэ төхөөрөмж дээр л хадгалагдсан; хаашаа ч илгээгдээгүй.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" className="oc-sc-btn" onClick={share}>ХУВААЛЦАХ</button>
        <button type="button" className="oc-sc-btn" onClick={copy}>ХУУЛАХ</button>
        <button type="button" className="oc-sc-btn" onClick={refresh}>ШИНЭЧЛЭХ</button>
        <button
          type="button"
          className="oc-sc-btn"
          onClick={() => {
            clearRecDiag();
            refresh();
            setNote('Цэвэрлэсэн.');
          }}
        >
          ЦЭВЭРЛЭХ
        </button>
      </div>
      {note && <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#DFFF4F', marginBottom: 10 }}>{note}</p>}
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          font: '400 11px/16px var(--oc-font-mono), monospace',
          background: '#08080A',
          border: '1px solid #1C1C21',
          padding: 10,
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      >
        {text || 'Одоогоор бичлэг алга. Бичлэг хийгээд буцаж ирнэ үү.'}
      </pre>
    </main>
  );
}
