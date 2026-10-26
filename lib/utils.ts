import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Polish plural noun for a count: 1 → one, 2–4 (but not 12–14) → few, else many. */
export function plural(n: number, one: string, few: string, many: string) {
	if (n === 1) return one;
	const d = n % 10;
	const t = n % 100;
	return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
