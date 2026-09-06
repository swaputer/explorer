import { formatUnits } from "ethers";

export function shortAddress(value: string, length = 4): string {
  return `${value.slice(0, 2 + length)}…${value.slice(-length)}`;
}

export function formatToken(value: bigint, decimals: number, maximumFractionDigits = 2): string {
  const numeric = Number(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(numeric);
}
