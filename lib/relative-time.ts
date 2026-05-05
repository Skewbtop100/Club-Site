export function formatRelativeTime(date: Date, lang: 'mn' | 'en' = 'mn'): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (lang === 'mn') {
    if (sec < 60) return 'дөнгөж сая';
    if (min < 60) return `${min} минутын өмнө`;
    if (hr < 24)  return `${hr} цагийн өмнө`;
    if (day < 7)  return `${day} өдрийн өмнө`;
    return date.toLocaleDateString('mn-MN');
  }
  // English fallback
  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24)  return `${hr}h ago`;
  if (day < 7)  return `${day}d ago`;
  return date.toLocaleDateString('en-US');
}
