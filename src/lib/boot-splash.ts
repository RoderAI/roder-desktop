// The boot splash is plain markup in index.html, so it paints before the renderer bundle runs.
// The app dismisses it once the first agent bootstrap has settled, whether it succeeded or failed.
const bootSplashId = "boot-splash";
const fadeOutMs = 160;

export function dismissBootSplash(doc: Pick<Document, "getElementById"> = document): void {
  const splash = doc.getElementById(bootSplashId);
  if (!splash || splash.classList.contains("is-leaving")) {
    return;
  }
  splash.classList.add("is-leaving");
  setTimeout(() => splash.remove(), fadeOutMs);
}
