/** How long a downloaded Blob's object URL stays readable. Safari can fail a
 * download whose URL is revoked as soon as the click returns. */
export const DOWNLOAD_URL_LIFETIME_MS = 30_000;

/** Saves Blobs through object URLs owned by one view. Each URL is released
 * once: after `DOWNLOAD_URL_LIFETIME_MS`, or at `release()` when the view
 * unmounts, whichever comes first. Later downloads remain possible. */
export function createFileDownloads(lifetimeMs = DOWNLOAD_URL_LIFETIME_MS) {
  const live = new Map<string, ReturnType<typeof setTimeout>>();
  const revoke = (url: string) => {
    if (!live.has(url)) return;
    clearTimeout(live.get(url));
    live.delete(url);
    URL.revokeObjectURL(url);
  };
  return {
    download(blob: Blob, filename: string) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      live.set(url, setTimeout(() => revoke(url), lifetimeMs));
    },
    release() {
      [...live.keys()].forEach(revoke);
    }
  };
}
