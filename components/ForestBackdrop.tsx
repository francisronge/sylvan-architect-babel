import React, { useMemo, useRef } from 'react';
import { useSporeDrift, type Spore } from '../hooks/useSporeDrift';

/** The page's light rays and drifting spores, placed once per page load. */
const ForestBackdrop: React.FC<{ paused: boolean }> = ({ paused }) => {
  const spores = useMemo<Spore[]>(
    () =>
      Array.from({ length: 12 }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 24,
        duration: 20 + Math.random() * 16,
        drift: 40 + Math.random() * 120
      })),
    []
  );
  const sporeLayerRef = useRef<HTMLDivElement>(null);
  useSporeDrift(sporeLayerRef, spores, paused);
  return (
    <>
      <div className="god-rays"></div>
      <div ref={sporeLayerRef} className="spore-layer" aria-hidden="true">
        {spores.map((spore, idx) => (
          <div key={idx} className="spore" style={{ left: `${spore.left}vw` }} />
        ))}
      </div>
    </>
  );
};

export default ForestBackdrop;
