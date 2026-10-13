'use client';

import { useLang } from '@/lib/i18n';

/** "Шүүсэн: <full name>" — who judged an entered result. Renders nothing
 *  when no judge was recorded (older results, imported results). */
export default function JudgedBy({ name, style }: { name?: string | null; style?: React.CSSProperties }) {
  const { t } = useLang();
  if (!name) return null;
  return (
    <div style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--muted)', lineHeight: 1.3, ...style }}>
      {t('results.judged-by')} {name}
    </div>
  );
}
