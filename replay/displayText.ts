/** Display plain camel-case names without interpreting notation or changing authored letters. */
export const spaceAuthoredName = (name: string): string => {
  if (!/^[A-Za-z]+$/.test(name)) return name;
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(' ');
  // Single-letter parts may be category notation, such as vP or CP.
  return words.some(word => word.length === 1) ? name : words.join(' ');
};
