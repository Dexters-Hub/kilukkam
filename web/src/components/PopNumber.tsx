/**
 * A number whose digits re-enter with a blurred slide each time it changes
 * (transitions-dev number pop-in). Keying the group on the text remounts it,
 * which replays the animation without any manual reflow.
 */
export function PopNumber({ value }: { value: string | number }) {
  const text = typeof value === 'number' ? value.toLocaleString() : value;
  const chars = [...text];
  return (
    <span key={text} className="t-digit-group is-animating" aria-label={text}>
      {chars.map((ch, i) => (
        <span key={i} className="t-digit" aria-hidden="true" data-stagger={i === chars.length - 2 ? '1' : i === chars.length - 1 ? '2' : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}
