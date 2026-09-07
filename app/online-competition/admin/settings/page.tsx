import AdminGate from '../_components/AdminGate';

// Placeholder shell — no functional settings yet, just the route + nav
// entry so the admin section's information architecture is complete.
export default function OnlineCompetitionAdminSettingsPage() {
  return (
    <AdminGate current="settings">
      <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1C1C21' }}>
          <span className="oc-v3-label">Тохиргоо</span>
        </div>
        <p className="text-sm" style={{ padding: '20px 16px', color: '#6E6A62' }}>
          Тохиргооны хэсэг удахгүй нэмэгдэнэ.
        </p>
      </div>
    </AdminGate>
  );
}
