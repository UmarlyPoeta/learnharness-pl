"use client";

import type { CacheRetention } from "@earendil-works/pi-ai";

const OPTIONS = [
	{ value: undefined, compact: "domyślnie", label: "Pi default", description: "Opcja nieustawiona. Obowiązuje zwykłe zachowanie Pi i nadpisanie ze zmiennych środowiskowych." },
	{ value: "none", compact: "bez żądania", label: "Nie żądaj cache", description: "Przekazuje do Pi natywną preferencję none. Dostawcy mogą nadal cache’ować automatycznie." },
	{ value: "short", compact: "krótka", label: "Krótka retencja", description: "Przekazuje do Pi natywną preferencję short. Czas zależy od dostawcy i modelu." },
	{ value: "long", compact: "długa", label: "Długa retencja", description: "Przekazuje do Pi natywną preferencję long. Koszt zapisu do cache może być wyższy." },
] as const;

export function cacheRetentionLabel(value: CacheRetention | undefined): string {
	return `Cache: ${OPTIONS.find((option) => option.value === value)!.compact}`;
}

export function CacheRetentionMenu({ value, onPick }: {
	value: CacheRetention | undefined;
	onPick: (value: CacheRetention | undefined) => void;
}) {
	return <>
		<div className="border-b border-border px-2 pb-2">
			<p className="text-card-foreground">Retencja cache</p>
			<p className="mt-1 text-muted-foreground">Ustala preferencję retencji cache przekazywaną do Pi. Obsługa i czas zależą od dostawcy i modelu. Nie gwarantuje trafienia w cache.</p>
		</div>
		{OPTIONS.map((option) => <button
			key={option.value ?? "default"}
			type="button"
			data-testid={`cache-retention-option-${option.value ?? "default"}`}
			aria-pressed={value === option.value}
			onClick={() => onPick(option.value)}
			className={`rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted ${value === option.value ? "bg-muted/60" : ""}`}
		>
			<span className="flex justify-between gap-2 text-card-foreground"><span>{option.label}</span>{value === option.value && <span aria-hidden>✓</span>}</span>
			<span className="mt-1 block text-muted-foreground">{option.description}</span>
		</button>)}
	</>;
}
