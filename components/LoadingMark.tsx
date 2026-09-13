import React from 'react';
import RootLogo from './RootLogo';

const LoadingMark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="relative" aria-hidden="true">
    <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150 animate-pulse motion-reduce:animate-none"></div>
    <div className={`relative z-10 ${compact ? 'w-20 h-20' : 'w-32 h-32'} rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner`}>
      <div className={`absolute inset-0 rounded-full ${compact ? 'border-4' : 'border-[6px]'} border-emerald-950/50 border-t-emerald-500 animate-spin motion-reduce:animate-none shadow-[0_0_100px_rgba(16,185,129,0.2)]`}></div>
      <RootLogo size={compact ? 64 : 104} shape="circle" blend zoom={0.92} className="animate-pulse motion-reduce:animate-none" />
    </div>
  </div>
);

export default LoadingMark;
