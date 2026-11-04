// Reused from web-coc (src/ui/visible-interval.ts) under the owner's code licence — see LICENSES/README.md.
/** Suspend periodic UI/economy work while hidden; wall-clock catch-up belongs to the caller. */
export function visibleInterval(callback: () => void, delay: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    if (document.hidden) {
      clearInterval(timer);
      timer = undefined;
    } else if (timer === undefined) timer = setInterval(callback, delay);
  };
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', update);
  };
}
