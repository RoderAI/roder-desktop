export const visibleToolActivityCount = 5;

export function followToolActivity(
  viewport: HTMLElement,
  content: HTMLElement,
  observeResize: (onResize: () => void) => Pick<ResizeObserver, "observe" | "disconnect"> = (onResize) =>
    new ResizeObserver(onResize),
): () => void {
  let pinned = true;
  const scrollToEnd = () => {
    if (pinned) viewport.scrollTop = viewport.scrollHeight;
  };
  const onScroll = () => {
    pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 16;
  };
  viewport.addEventListener("scroll", onScroll, { passive: true });
  const observer = observeResize(scrollToEnd);
  observer.observe(content);
  scrollToEnd();
  return () => {
    observer.disconnect();
    viewport.removeEventListener("scroll", onScroll);
  };
}
