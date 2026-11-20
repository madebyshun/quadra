import { MACHINE } from "@/intro/photo";

/**
 * The Quadra workstation model, straight on: a 1990s beige CRT monitor with sculpted bezel
 * resting on a horizontal desktop chassis (with 3.5" floppy drive & cooling louvers), a full
 * mechanical keyboard with numpad, and a wired mouse — set on a sunlit green hill. The CRT glass
 * sits at `MACHINE.screen` so live HTML renders cleanly inside it.
 */

const W = MACHINE.width;
const H = MACHINE.height;

function keys() {
  const rows = [
    { y: 736, n: 13, x0: 196, x1: 646 },
    { y: 759, n: 13, x0: 190, x1: 652 },
    { y: 782, n: 12, x0: 184, x1: 658 },
    { y: 806, n: 11, x0: 178, x1: 664 },
  ];
  const out = [];
  for (const r of rows) {
    const step = (r.x1 - r.x0) / r.n;
    for (let i = 0; i < r.n; i++) {
      out.push(
        <rect
          key={`${r.y}-${i}`}
          x={r.x0 + i * step + 2}
          y={r.y}
          width={step - 4}
          height="17"
          rx="2.5"
          fill="url(#m-key)"
          stroke="#a99d83"
          strokeWidth="0.9"
        />,
      );
    }
  }
  // Numpad cluster on the right
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out.push(
        <rect
          key={`np-${row}-${col}`}
          x={678 + col * 26}
          y={736 + row * 23}
          width={22}
          height="17"
          rx="2.5"
          fill="url(#m-key)"
          stroke="#a99d83"
          strokeWidth="0.9"
        />,
      );
    }
  }
  // Spacebar
  out.push(<rect key="space" x="280" y="830" width="270" height="18" rx="3" fill="url(#m-key)" stroke="#a99d83" strokeWidth="0.9" />);
  return out;
}

export function Machine() {
  const s = MACHINE.screen;
  const gx = s.left * W;
  const gy = s.top * H;
  const gw = s.width * W;
  const gh = s.height * H;
  return (
    <svg className="pintro__machine" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="a beige Macintosh Quadra workstation seen straight on, resting on a sunlit green hill">
      <defs>
        <linearGradient id="m-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3ede0" />
          <stop offset="0.5" stopColor="#e2d8c0" />
          <stop offset="1" stopColor="#c7baa0" />
        </linearGradient>
        <linearGradient id="m-chassis" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ebe2cd" />
          <stop offset="0.18" stopColor="#ddd2b8" />
          <stop offset="1" stopColor="#bfb296" />
        </linearGradient>
        <linearGradient id="m-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#cfc3a8" />
          <stop offset="0.06" stopColor="#0000" />
          <stop offset="0.94" stopColor="#0000" />
          <stop offset="1" stopColor="#b8ab8e" />
        </linearGradient>
        <linearGradient id="m-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#beb298" />
          <stop offset="0.5" stopColor="#d4cab2" />
          <stop offset="1" stopColor="#e6dec9" />
        </linearGradient>
        <linearGradient id="m-key" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f1e3" />
          <stop offset="1" stopColor="#d7ccb4" />
        </linearGradient>
        <linearGradient id="m-board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ece3cf" />
          <stop offset="0.85" stopColor="#cfc3a7" />
          <stop offset="1" stopColor="#b2a588" />
        </linearGradient>
        <radialGradient id="m-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#142d06" stopOpacity="0.48" />
          <stop offset="0.7" stopColor="#142d06" stopOpacity="0.22" />
          <stop offset="1" stopColor="#142d06" stopOpacity="0" />
        </radialGradient>
        <filter id="m-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#102407" floodOpacity="0.32" />
        </filter>
      </defs>

      {/* Contact shadow on the grassy hill */}
      <ellipse cx="520" cy="702" rx="340" ry="26" fill="url(#m-shadow)" />
      <ellipse cx="515" cy="866" rx="390" ry="20" fill="url(#m-shadow)" />

      {/* Wired mouse & cord on the right */}
      <path d="M775 642 C835 642, 815 735, 865 748 C895 756, 875 796, 868 806" fill="none" stroke="#c8bda3" strokeWidth="4.5" strokeLinecap="round" />
      <g filter="url(#m-soft)">
        <ellipse cx="868" cy="832" rx="34" ry="25" fill="url(#m-board)" stroke="#a99d83" strokeWidth="2" />
        <line x1="868" y1="808" x2="868" y2="826" stroke="#a99d83" strokeWidth="1.5" />
        <path d="M842 824 Q868 830 894 824" fill="none" stroke="#b3a88f" strokeWidth="1.2" />
      </g>

      <g filter="url(#m-soft)">
        {/* Horizontal Desktop Chassis */}
        <rect x="215" y="574" width="570" height="114" rx="10" fill="url(#m-chassis)" stroke="#a99d83" strokeWidth="2.5" />
        <rect x="215" y="574" width="570" height="114" rx="10" fill="url(#m-side)" />
        {/* Chassis top highlight & front seam */}
        <rect x="224" y="577" width="552" height="4" rx="2" fill="#fffaf0" opacity="0.55" />
        <line x1="217" y1="646" x2="783" y2="646" stroke="#b3a88f" strokeWidth="1.5" />
        {/* Left cooling louvers */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={`v-${i}`} x="236" y={594 + i * 9} width="136" height="4" rx="1.5" fill="#9f9379" />
        ))}
        {/* Power button on chassis */}
        <rect x="236" y="656" width="22" height="14" rx="2.5" fill="#d8ceb7" stroke="#9b9077" strokeWidth="1.2" />
        <circle cx="247" cy="663" r="3" fill="#6b6352" />
        {/* 3.5" Floppy drive bay on the right */}
        <rect x="598" y="592" width="154" height="34" rx="3" fill="#d2c7ae" stroke="#a3977d" strokeWidth="1.5" />
        <rect x="614" y="604" width="108" height="7" rx="2" fill="#2b2822" />
        <rect x="698" y="616" width="24" height="6" rx="1.5" fill="#bdb197" stroke="#8e826a" strokeWidth="1" />
        <rect x="614" y="617" width="12" height="4" rx="1" fill="#8b8068" />

        {/* Tilt-swivel monitor stand */}
        <path d="M402 540 L598 540 L622 574 L378 574 Z" fill="url(#m-bezel)" stroke="#a99d83" strokeWidth="2" />
        <rect x="364" y="566" width="272" height="10" rx="4" fill="url(#m-board)" stroke="#a99d83" strokeWidth="1.8" />

        {/* CRT Monitor outer sculpted case */}
        <rect x="182" y="42" width="636" height="504" rx="26" fill="url(#m-body)" stroke="#a99d83" strokeWidth="3" />
        <rect x="182" y="42" width="636" height="504" rx="26" fill="url(#m-side)" />
        <rect x="198" y="50" width="604" height="8" rx="4" fill="#fffaf0" opacity="0.65" />

        {/* Recessed CRT bezel & dark glass cavity */}
        <rect x={gx - 38} y={gy - 30} width={gw + 76} height={gh + 62} rx="22" fill="url(#m-bezel)" stroke="#9e9278" strokeWidth="2" />
        <rect x={gx - 12} y={gy - 10} width={gw + 24} height={gh + 20} rx="24" fill="#23221e" />
        <rect x={gx} y={gy} width={gw} height={gh} rx="20" fill="#091124" />

        {/* Monitor chin: speaker grille, Quadra q mark, power switch & glowing LED */}
        {[0, 1, 2].map((i) => (
          <rect key={`sp-${i}`} x="224" y={518 + i * 7} width="76" height="3" rx="1.5" fill="#a89c82" />
        ))}
        <g transform="translate(486 516) scale(0.45)">
          <path d="M44 44H16V16H44V44L55 55" fill="none" stroke="#2422cf" strokeWidth="8" strokeLinejoin="round" />
        </g>
        <rect x="708" y="520" width="32" height="12" rx="2.5" fill="#cfc4aa" stroke="#9e9278" />
        <circle className="pintro__led" cx="760" cy="526" r="4.5" fill="#2d4c35" />

        {/* Mechanical Keyboard with Numpad */}
        <path d="M188 720 L792 720 L822 862 L158 862 Z" fill="url(#m-board)" stroke="#a3977d" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="162" y1="858" x2="818" y2="858" stroke="#978b72" strokeWidth="2" />
        {keys()}
      </g>
    </svg>
  );
}
