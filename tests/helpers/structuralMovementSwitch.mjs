/** Runs `run` with `BABEL_STRUCTURAL_MOVEMENT` set to `value` ('0' off, '1' on,
 * undefined for the default), restoring the previous setting afterwards. Tests
 * use it to reach the neutral-copy path that Replay takes whenever structure
 * declines to read a displacement. */
export const withStructuralMovement = (value, run) => {
  const name = 'BABEL_STRUCTURAL_MOVEMENT', before = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return run(); } finally { if (before === undefined) delete process.env[name]; else process.env[name] = before; }
};
