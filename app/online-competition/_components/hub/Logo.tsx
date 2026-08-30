// 3x3 grid logo: ink,ink,volt / ink,volt,ink / volt,ink,ink
const PATTERN = ['ink', 'ink', 'volt', 'ink', 'volt', 'ink', 'volt', 'ink', 'ink'] as const;
const COLOR = { ink: '#16140F', volt: '#DFFF4F' } as const;

export default function Logo() {
  return (
    <div className="oc-hub-logo-grid" aria-hidden>
      {PATTERN.map((tone, i) => (
        <span key={i} style={{ width: 5, height: 5, background: COLOR[tone] }} />
      ))}
    </div>
  );
}
