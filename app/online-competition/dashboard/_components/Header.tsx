import type { OnlineAuthUser } from '@/lib/online-competition/useOnlineAuth';

export default function Header({ user }: { user: OnlineAuthUser }) {
  const initial = (user.displayName ?? 'Т').trim().charAt(0).toUpperCase();

  return (
    <header className="oc-dash-header">
      <div>
        <p style={{ font: '600 17px var(--oc-font-heading), sans-serif', color: '#16140F' }}>
          {user.displayName ?? 'Тамирчин'}
        </p>
        {/* No PR/solve-count/points data model exists yet — static
            placeholder rather than fabricated numbers. */}
        <p style={{ marginTop: 4, font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#8A8474' }}>
          — · — ТАЙЛАЛТ · — ОНОО
        </p>
      </div>
      {user.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar
        // comes from Google's CDN, not our own image pipeline.
        <img
          src={user.photoURL}
          alt=""
          width={30}
          height={30}
          style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#16140F',
            color: '#DFFF4F',
            font: '600 10px var(--oc-font-mono), monospace',
          }}
        >
          {initial}
        </span>
      )}
    </header>
  );
}
