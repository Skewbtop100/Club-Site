import Link from 'next/link';

export default function EmptyDashboard() {
  return (
    <div className="oc-dash-empty">
      <div className="oc-dash-empty-icon" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="oc-dash-empty-icon-cell" />
        ))}
      </div>
      <p style={{ font: '500 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
        Бүртгүүлсэн тэмцээн алга.
      </p>
      <Link href="/online-competition" className="oc-hub-signin-btn">
        Тэмцээн үзэх
      </Link>
    </div>
  );
}
