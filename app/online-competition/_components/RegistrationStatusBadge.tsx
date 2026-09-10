import type { OnlineRegistrationStatus } from '@/lib/online-competition/types';
import { registrationStatusCopy } from '@/lib/online-competition/registration-view';

/** An athlete's registration status as a small tone-coloured badge.
 *
 *  ONE component for every public place the status appears — the
 *  Бүртгүүлэх panel, the detail page sidebar, the dashboard cards and the
 *  hub's "Миний тэмцээнүүд" — with the wording from registrationStatusCopy,
 *  so no two of them can describe the same registration differently.
 *
 *  `withDetail` adds the short explanation after the label
 *  ("ХҮЛЭЭГДЭЖ БУЙ · Зохион байгуулагч хянаж байна") where there is room. */
export default function RegistrationStatusBadge({
  status,
  withDetail = false,
}: {
  status: OnlineRegistrationStatus;
  withDetail?: boolean;
}) {
  const copy = registrationStatusCopy(status);
  return (
    <span className={`oc-rs oc-rs-${copy.tone}`}>
      <span className="oc-rs-dot" aria-hidden />
      <span className="oc-rs-label">{copy.label}</span>
      {withDetail && copy.detail && <span className="oc-rs-detail">· {copy.detail}</span>}
    </span>
  );
}
