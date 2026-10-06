export const describeViewError = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string' && error) return error;
  return 'Unexpected rendering error.';
};

export const rethrowViewError = (error: unknown): never => { throw error; };

/** React boundaries do not catch callbacks scheduled outside React's lifecycle. */
export function guardViewCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
  onError: (error: unknown) => void
): (...args: Args) => Result | undefined {
  return function (...args: Args) {
    try { return callback.apply(this, args); }
    catch (error) { onError(error); }
  };
}
