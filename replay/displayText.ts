/**
 * Display plain camel-case names without interpreting notation or changing authored letters.
 * With `snakeCase`, single underscores between Latin words also become spaces; the Replay
 * panel's relation and role names and the Tier-3 tree role labels opt in. Other names,
 * including non-Latin ones, are unchanged.
 */
export const spaceAuthoredName = (name: string, { snakeCase = false } = {}): string => {
  if (!(snakeCase ? /^[A-Za-z]+(?:_[A-Za-z]+)*$/ : /^[A-Za-z]+$/).test(name)) return name;
  const words = name.split('_').flatMap(part => part.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(' '));
  // Single-letter parts may be category notation, such as vP, CP or x_i.
  return words.some(word => word.length === 1) ? name : words.join(' ');
};
