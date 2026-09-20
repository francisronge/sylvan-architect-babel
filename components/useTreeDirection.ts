import { useLayoutEffect, useState } from 'react';
import type { TreeDirection } from '../replay/treeLayout.ts';

/** Use the browser's Unicode first-strong direction, including mixed scripts and isolates. */
export function resolveTreeDirection(text: string, document: Document): TreeDirection {
  const probe = document.createElement('bdi');
  probe.dir = 'auto';
  probe.textContent = text;
  probe.style.display = 'none';
  document.body.append(probe);
  try {
    return document.defaultView?.getComputedStyle(probe).direction === 'rtl' ? 'rtl' : 'ltr';
  } finally {
    probe.remove();
  }
}

export function useTreeDirection(sentence: string): TreeDirection {
  const [direction, setDirection] = useState<TreeDirection>('ltr');
  useLayoutEffect(() => { setDirection(resolveTreeDirection(sentence, document)); }, [sentence]);
  return direction;
}
