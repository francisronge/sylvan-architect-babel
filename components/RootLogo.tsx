import React from 'react';

interface RootLogoProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
  shape?: 'square' | 'circle';
  blend?: boolean;
  zoom?: number;
  inset?: number;
}

const RootLogo: React.FC<RootLogoProps> = ({
  size = 24,
  className,
  shape = 'square',
  blend = true,
  zoom = 1.12,
  inset
}) => {
  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-[22%]';
  const imageInset = inset ?? 0;
  const isCircle = shape === 'circle';
  const shellBackground = blend
    ? 'linear-gradient(145deg, #053a2d 0%, #065f46 55%, #064e3b 100%)'
    : 'transparent';

  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden isolate ${radiusClass} ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: shellBackground
      }}
    >
      <img
        src="/babellogo.png"
        alt="Babel logo"
        className="absolute h-full w-full select-none pointer-events-none"
        style={{
          top: `${imageInset}%`,
          left: `${imageInset}%`,
          width: `${100 - imageInset * 2}%`,
          height: `${100 - imageInset * 2}%`,
          borderRadius: isCircle ? '9999px' : 0,
          objectFit: 'cover',
          transform: `scale(${zoom})`,
          transformOrigin: 'center',
          mixBlendMode: blend ? 'screen' : 'normal',
          opacity: blend ? 0.95 : 1,
          filter: blend ? 'saturate(1.12) contrast(1.04) brightness(1.08)' : 'none'
        }}
        draggable={false}
      />
      {blend && (
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 30% 24%, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.08) 45%, rgba(16,185,129,0) 100%)'
          }}
        />
      )}
    </span>
  );
};

export default RootLogo;
