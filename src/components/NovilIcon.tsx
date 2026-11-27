export const NovilIcon = ({
  size = 24,
  blink = false,
}: {
  size?: number;
  blink?: boolean;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="novil-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
      <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="20" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <rect width="1024" height="1024" rx="224" fill="#0a0f1e" />
    <rect
      x="24"
      y="24"
      width="976"
      height="976"
      rx="200"
      stroke="url(#novil-gradient)"
      strokeWidth="16"
      fill="none"
    />

    <g
      fontFamily="monospace"
      fontSize="160"
      fontWeight="bold"
      fill="url(#novil-gradient)"
      textAnchor="middle"
      filter="url(#neon-glow)"
    >
      <text x="380" y="565" className={blink ? "blink-eye" : ""}>
        #
      </text>
      <text x="512" y="565">
        _
      </text>
      <text x="644" y="565" className={blink ? "blink-eye" : ""}>
        @
      </text>
    </g>
  </svg>
);
