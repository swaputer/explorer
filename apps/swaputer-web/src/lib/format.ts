import { formatUnits } from "ethers";

export function compactHash(value?: string | null, start = 8, end = 6): string {
  if (!value) return "—";
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "UTC", timeZoneName: "short"
  }).format(new Date(value));
}

export function integer(value: string | number | bigint): string {
  try { return BigInt(value).toLocaleString("en-US"); } catch { return String(value); }
}

export function tokenAmount(value: string | bigint, decimals = 18, fraction = 6): string {
  try {
    const amount = BigInt(value);
    const formatted = formatUnits(amount, decimals);
    const [whole = "0", decimal = ""] = formatted.split(".");
    const grouped = BigInt(whole).toLocaleString("en-US");
    const trimmed = decimal.slice(0, fraction).replace(/0+$/, "");
    if (!trimmed && amount !== 0n && whole === "0" && fraction > 0) return `<0.${"0".repeat(fraction - 1)}1`;
    return trimmed ? `${grouped}.${trimmed}` : grouped;
  } catch {
    return "—";
  }
}

export function nativeAmount(value: string | bigint, fraction = 9): string {
  return tokenAmount(value, 18, fraction);
}

export function share(balance: string, total: string): number {
  try {
    const denominator = BigInt(total);
    if (denominator <= 0n) return 0;
    return Number(BigInt(balance) * 10_000n / denominator) / 100;
  } catch {
    return 0;
  }
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard?.writeText(value);
}
