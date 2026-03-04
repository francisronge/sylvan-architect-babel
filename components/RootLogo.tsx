import React from 'react';

interface RootLogoProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const RootLogo: React.FC<RootLogoProps> = ({
  size = 24,
  className,
  strokeWidth = 7
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 128 128"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <g
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M38 12H90" />
      <path d="M64 12V46" />
      <path d="M64 46L56 64" />
      <path d="M64 46L74 62" />
      <path d="M56 64L40 76" />
      <path d="M56 64L60 88" />
      <path d="M74 62L92 74" />
      <path d="M74 62L68 90" />
      <path d="M40 76L24 88" />
      <path d="M40 76L34 112" />
      <path d="M60 88L56 114" />
      <path d="M60 88L68 114" />
      <path d="M92 74L108 88" />
      <path d="M92 74L102 108" />
      <path d="M68 90L84 104" />
      <path d="M84 104L92 118" />
      <path d="M56 64L46 66" />
      <path d="M74 62L84 64" />
      <path d="M34 112L26 124" />
      <path d="M68 114L80 124" />
      <path d="M102 108L114 118" />
    </g>
  </svg>
);

export default RootLogo;
