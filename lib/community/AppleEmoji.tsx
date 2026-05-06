'use client';

interface Props {
  emoji: string;
  size?: number;
  className?: string;
}

/**
 * Render an emoji as an Apple-style image from a public CDN.
 * Falls back to native emoji if image fails.
 * Uses fxemoji/twemoji-apple via cdn.jsdelivr.net.
 */
export function AppleEmoji({ emoji, size = 16, className = '' }: Props) {
  // Convert emoji char(s) to Unicode codepoints in the format jsdelivr expects
  const codepoints = Array.from(emoji)
    .map(c => c.codePointAt(0)!.toString(16))
    .filter(c => c !== 'fe0f') // strip variation selector
    .join('-');

  const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoints}.png`;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={emoji}
      className={className}
      width={size}
      height={size}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        width: size,
        height: size,
      }}
      onError={(e) => {
        // Fallback: replace with native emoji span
        const span = document.createElement('span');
        span.textContent = emoji;
        span.style.fontSize = `${size}px`;
        e.currentTarget.replaceWith(span);
      }}
    />
  );
}
