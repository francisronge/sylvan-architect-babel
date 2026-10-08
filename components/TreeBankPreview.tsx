import React, { useEffect, useRef, useState } from 'react';
import { readTreeBankPreview } from '../services/treeBankStore';

/** Preview bytes are loaded only when their card approaches the viewport. */
export default function TreeBankPreview({ previewId, sentence }: { previewId?: string; sentence: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!previewId) return;
    let cancelled = false;
    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void readTreeBankPreview(previewId).then(url => {
        if (!cancelled && url) setImage({ id: previewId, url });
      }).catch(() => { /* A damaged preview does not prevent opening the saved analysis. */ });
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        load();
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (container.current) observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [previewId]);
  return <div ref={container} className="w-full h-full">
    {image && image.id === previewId ? <img
      src={image.url}
      alt={`Tree snapshot for "${sentence}"`}
      className="w-full h-full object-contain"
      loading="lazy"
    /> : <div className="w-full h-full flex items-center justify-center text-emerald-400/50 text-[10px] font-black uppercase tracking-[0.28em]">
      Tree preview unavailable
    </div>}
  </div>;
}
