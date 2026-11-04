// Reused from web-coc (src/ui/first-audio-gesture.ts) under the owner's code licence — see LICENSES/README.md.
/** Unlock opted-in audio on the first pointer, printable key, Tab or Enter, then drop both listeners. */
export function onFirstAudioGesture(activate: () => void, target: EventTarget = document) {
  const remove = () => {
    target.removeEventListener('pointerdown', start);
    target.removeEventListener('keydown', key);
  };
  const start = () => {
    remove();
    activate();
  };
  const key = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab') start();
  };
  target.addEventListener('pointerdown', start, { passive: true });
  target.addEventListener('keydown', key);
  return remove;
}
