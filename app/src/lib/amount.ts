/** Parse a human ZINC amount (e.g. "1.5") into raw base units (9 decimals). */
export function toBaseUnits(human: string, decimals = 9): bigint {
  const [whole, frac = ""] = human.trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

/** Format raw base units into a human ZINC string. */
export function fromBaseUnits(raw: bigint, decimals = 9): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
