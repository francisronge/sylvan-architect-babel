/** Runs `run` with `BABEL_STRUCTURAL_RECOGNITION` set to `value` ('0' off, '1'
 * the safe rules, undefined for the default), restoring the previous setting.
 * Tests use it to separate what wording refuses from what structure reads. */
export const withStructuralRecognition = (value, run) => {
  const name = 'BABEL_STRUCTURAL_RECOGNITION', before = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return run(); } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before; }
};
