export function diceCoefficient(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bi = s.slice(i, i + 2);
      map.set(bi, (map.get(bi) || 0) + 1);
    }
    return map;
  };

  const bg1 = bigrams(na);
  const bg2 = bigrams(nb);
  let intersection = 0;
  for (const [bi, count] of bg1) {
    intersection += Math.min(count, bg2.get(bi) || 0);
  }

  const total = na.length - 1 + nb.length - 1;
  return (2 * intersection) / total;
}
