import { useEffect, useState } from 'react';

const BLOCKED_MESSAGE = 'The browser blocked fullscreen. Select this tab and try again, or use the browser\'s fullscreen command.';

/**
 * Whole-page fullscreen, following the document's state however it changes
 * (the button, Escape or a browser command). Each change scrolls the page to its
 * origin and announces a resize, at the next frame and again shortly after, so
 * the tree refits to the new viewport. A refused request leaves a message until
 * the next attempt.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
      });
      window.setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
      }, 80);
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      setFullscreenError(BLOCKED_MESSAGE);
      console.error('Fullscreen toggle failed', err);
    }
  };

  return { isFullscreen, fullscreenError, toggleFullscreen };
}
