/** Cache immutable string results without retaining an unbounded authored vocabulary. */
export function boundedStringTransform(transform: (value: string) => string, capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('String cache capacity must be positive.');
  const values = new Map<string, string>();
  return (value: string): string => {
    if (value.length > 4096) return transform(value);
    const cached = values.get(value);
    if (cached !== undefined) return cached;
    const result = transform(value);
    if (result.length > 4096) return result;
    if (values.size >= capacity) values.clear();
    values.set(value, result);
    return result;
  };
}
