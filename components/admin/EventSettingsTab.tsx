'use client';

import { useEffect, useState } from 'react';
import { getEventVisibility, saveEventVisibility } from '@/lib/firebase/services/records';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { EventVisibility } from '@/lib/types';

type Visibility = 'auto' | 'show' | 'hide';

export default function EventSettingsTab() {
  const [settings, setSettings] = useState<EventVisibility>({});
  const [loading, setLoading]   = useState(true);
  const [msg, setMsg]           = useState(''); const [msgType, setMsgType] = useState('');

  useEffect(() => {
    // Reads from settings/eventVisibility (canonical path, fixed from old config/eventVisibility)
    getEventVisibility()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setVis(id: string, val: Visibility) {
    setSettings(prev => ({ ...prev, [id]: val }));
  }

  async function save() {
    try {
      await saveEventVisibility(settings);
      setMsgType('success'); setMsg('Event visibility saved.');
    } catch (e: unknown) {
      setMsgType('error'); setMsg('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
    setTimeout(() => setMsg(''), 4000);
  }

  if (loading) return <div className="spinner-row">Loading<span className="spinner-ring" /></div>;

  const options: Visibility[] = ['auto', 'show', 'hide'];
  const optionLabels: Record<Visibility, string> = { auto: 'Auto', show: 'Always Show', hide: 'Always Hide' };

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />Event Visibility Settings</div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.2rem' }}>
        Control which events appear in rankings and records. &ldquo;Auto&rdquo; shows events that have at least one result.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.2rem' }}>
        {WCA_EVENTS.map(ev => {
          const vis = (settings[ev.id] as Visibility) || 'auto';
          return (
            <div key={ev.id} style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '0.6rem 0.9rem', borderRadius: '10px',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ flex: 1, fontSize: '0.88rem', color: 'var(--text)', fontWeight: 500 }}>
                <span style={{ fontFamily: 'monospace', color: '#a78bfa', marginRight: '0.5rem', fontSize: '0.78rem' }}>{ev.short}</span>
                {ev.name}
              </div>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                {options.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setVis(ev.id, opt)}
                    style={{
                      padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit', border: 'none',
                      background: vis === opt
                        ? opt === 'show' ? 'rgba(34,197,94,0.2)' : opt === 'hide' ? 'rgba(244,63,94,0.2)' : 'rgba(124,58,237,0.2)'
                        : 'rgba(255,255,255,0.05)',
                      color: vis === opt
                        ? opt === 'show' ? '#4ade80' : opt === 'hide' ? '#f43f5e' : '#a78bfa'
                        : 'var(--muted)',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {optionLabels[opt]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn-sm-primary" onClick={save}>Save Settings</button>
      {msg && <div className={`msg ${msgType}`} style={{ display: 'block', marginTop: '0.8rem' }}>{msg}</div>}
    </div>
  );
}
