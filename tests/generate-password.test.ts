import { describe, expect, it } from "vitest";
import { generatePassword, PASSWORD_ALPHABET } from "@/lib/generate-password";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

describe("generatePassword", () => {
  it("is long enough to satisfy the password rule", () => {
    // 14 characters plus the separator.
    expect(generatePassword()).toHaveLength(15);
    expect(generatePassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it("contains only unambiguous characters and the separator", () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generatePassword()) {
        if (char === "-") continue;
        expect(PASSWORD_ALPHABET).toContain(char);
      }
    }
  });

  it("never emits a character that is misread down a phone", () => {
    const ambiguous = ["O", "0", "l", "1", "I"];
    const sample = Array.from({ length: 300 }, () => generatePassword()).join("");
    for (const char of ambiguous) {
      expect(sample).not.toContain(char);
    }
  });

  it("puts the separator in the same place every time", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generatePassword().indexOf("-")).toBe(7);
    }
  });

  it("does not repeat itself", () => {
    const generated = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(generated.size).toBe(500);
  });

  it("honours a requested length", () => {
    expect(generatePassword(20)).toHaveLength(21);
    expect(generatePassword(10)).toHaveLength(11);
  });

  it("draws evenly across the alphabet, with no bias to its front", () => {
    // The failure mode this guards against is specific. A plain
    // `byte % 55` maps 256 bytes onto 55 characters unevenly: the first 36
    // characters get five source bytes each, the remaining 19 get four. That
    // is a 25% skew between the two groups, so comparing them directly is a
    // far sharper test than per-character bounds — which are swamped by
    // sampling noise at any realistic sample size.
    const counts = new Map<string, number>();
    const passwords = 6_000;
    for (let i = 0; i < passwords; i += 1) {
      for (const char of generatePassword().replace("-", "")) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(PASSWORD_ALPHABET.length);

    const advantaged = PASSWORD_ALPHABET.slice(0, 256 % PASSWORD_ALPHABET.length);
    const rest = PASSWORD_ALPHABET.slice(256 % PASSWORD_ALPHABET.length);
    const perChar = (group: string) =>
      [...group].reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) / group.length;

    // Uniform draws put these within noise of each other; the modulo version
    // separates them by about 25%.
    const ratio = perChar(advantaged) / perChar(rest);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });
});
