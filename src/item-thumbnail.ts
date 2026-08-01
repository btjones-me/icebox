const INITIAL_PARTS = /[\p{L}\p{N}]+/gu;
const UPPERCASE_LETTER = /\p{Lu}/u;

export function itemInitials(label: string): string {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) return "?";

  const uppercaseLetters = Array.from(normalizedLabel).filter((character) => UPPERCASE_LETTER.test(character));
  if (uppercaseLetters.length >= 2) return uppercaseLetters.slice(0, 2).join("");

  const words = normalizedLabel.match(INITIAL_PARTS) ?? [];
  if (!words.length) return "?";
  const firstInitial = Array.from(words[0] ?? "?")[0] ?? "?";
  if (words.length === 1) return firstInitial.toLocaleUpperCase();

  const secondInitial = Array.from(words[1] ?? "")[0] ?? "";
  return `${firstInitial}${secondInitial}`.toLocaleUpperCase();
}

export function itemThumbnailColour(itemId: string, paletteSize = 6): number {
  let hash = 0;
  for (const character of itemId || "new-item") {
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % paletteSize;
}
