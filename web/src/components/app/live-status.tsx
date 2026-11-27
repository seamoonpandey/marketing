/** A polite announcement for screen readers, for a change that is otherwise shown only by a list or badge moving. Always rendered, so the region exists before its text does. */
export function LiveStatus({ message }: { message: string }) {
  return <p role="status" className="sr-only">{message}</p>;
}
