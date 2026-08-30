'use client';

import { useState } from 'react';

type KeyDef =
  | { label: string; type: 'digit'; value: string }
  | { label: string; type: 'dnf' }
  | { label: string; type: 'backspace' };

const KEYS: KeyDef[] = [
  { label: '1', type: 'digit', value: '1' },
  { label: '2', type: 'digit', value: '2' },
  { label: '3', type: 'digit', value: '3' },
  { label: '4', type: 'digit', value: '4' },
  { label: '5', type: 'digit', value: '5' },
  { label: '6', type: 'digit', value: '6' },
  { label: '7', type: 'digit', value: '7' },
  { label: '8', type: 'digit', value: '8' },
  { label: '9', type: 'digit', value: '9' },
  { label: 'DNF', type: 'dnf' },
  { label: '0', type: 'digit', value: '0' },
  { label: '⌫', type: 'backspace' },
];

function formatDigits(digits: string): string {
  const padded = digits.padStart(6, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}.${padded.slice(4, 6)}`;
}

function digitsToCentiseconds(digits: string): number {
  const padded = digits.padStart(6, '0');
  const mm = parseInt(padded.slice(0, 2), 10);
  const ss = parseInt(padded.slice(2, 4), 10);
  const cc = parseInt(padded.slice(4, 6), 10);
  return mm * 6000 + ss * 100 + cc;
}

export default function EntryStage({
  onConfirm,
}: {
  onConfirm: (result: { timeCs: number | null; isDnf: boolean }) => void;
}) {
  const [digits, setDigits] = useState('');
  const [isDnf, setIsDnf] = useState(false);

  function press(key: KeyDef) {
    if (key.type === 'digit') {
      setIsDnf(false);
      setDigits((prev) => (prev + key.value).slice(-6));
    } else if (key.type === 'backspace') {
      setIsDnf(false);
      setDigits((prev) => prev.slice(0, -1));
    } else {
      setIsDnf(true);
      setDigits('');
    }
  }

  function handleConfirm() {
    onConfirm({ timeCs: isDnf ? null : digitsToCentiseconds(digits), isDnf });
  }

  const canConfirm = isDnf || digits.length > 0;

  return (
    <div className="oc-solve-entry">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          ЦАГАА БИЧ · ММ:СС.ХХ
        </p>
        <div className="oc-solve-entry-well" style={{ marginTop: 10 }}>
          <span className="oc-solve-entry-digits" style={isDnf ? { color: '#D8402C' } : undefined}>
            {isDnf ? 'DNF' : formatDigits(digits)}
          </span>
        </div>

        <div className="oc-solve-keypad">
          {KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              onClick={() => press(key)}
              className={`oc-solve-key${key.type === 'dnf' ? ' oc-solve-key-dnf' : ''}`}
            >
              {key.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="oc-solve-btn-confirm" disabled={!canConfirm} onClick={handleConfirm}>
        Бататгах
      </button>
    </div>
  );
}
