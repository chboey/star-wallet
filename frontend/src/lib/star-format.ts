import { formatUnits, getAddress, isAddress } from "viem";
import type { StarChild } from "./star-api";
import { goalIconAsset } from "./goal-requests";

export function formatTokenAmount(
  amount: string | bigint | undefined | null,
  decimals: number,
  maximumFractionDigits = 4,
): string {
  if (
    amount === undefined ||
    amount === null ||
    (typeof amount === "string" && !/^[0-9]+$/.test(amount)) ||
    (typeof amount === "bigint" && amount < 0n)
  )
    return "—";
  const raw = typeof amount === "bigint" ? amount : safeBigInt(amount);
  const [whole, fraction = ""] = formatUnits(raw, decimals).split(".");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function formatUsd18(
  amount: string | bigint | undefined | null,
): string {
  const formatted = formatTokenAmount(amount, 18, 2);
  if (formatted === "—") return formatted;
  const [whole, fraction] = formatted.split(".");
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(BigInt(whole));
  return `$${fraction ? `${grouped}.${fraction.padEnd(2, "0")}` : grouped}`;
}

export function availableStars(
  child?: Pick<StarChild, "starBalance" | "reservedStars"> | null,
) {
  if (!child) return 0n;
  const balance = safeBigInt(child.starBalance);
  const reserved = safeBigInt(child.reservedStars);
  return balance > reserved ? balance - reserved : 0n;
}

export function displayEnsName(
  name: string | null | undefined,
  fallback: string,
): string {
  const label = name?.split(".")[0]?.trim();
  if (!label) return fallback;
  return label
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortHex(value: string | null | undefined): string {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function checksumOrOriginal(value: string): string {
  return isAddress(value) ? getAddress(value) : value;
}

export function activityDate(timestamp: string): string {
  const date = new Date(Number(timestamp) * 1_000);
  if (Number.isNaN(date.getTime())) return "On-chain";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function goalIllustration(title: string, icon?: number): string {
  if (icon !== undefined) return goalIconAsset(icon);
  const normalized = title.toLowerCase();
  if (/bike|bicycle|cycle/.test(normalized)) return "bicycle_sparkle";
  if (/book|read/.test(normalized)) return "books";
  if (/paint|art|draw/.test(normalized)) return "paint";
  if (/game|console/.test(normalized)) return "console";
  if (/teddy|bear|toy/.test(normalized)) return "teddy_bear_sparkle";
  if (/rocket|space/.test(normalized)) return "rocket_sparkle";
  return "star_sparkle";
}

export function safeBigInt(value: string | bigint | undefined | null): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > maximumBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}
