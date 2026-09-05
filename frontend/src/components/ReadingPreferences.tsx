import { Minus, Plus, Type, AlignJustify } from "lucide-react";
type Props = {
  scale: number;
  onScale: (next: number) => void;
  comfortable: boolean;
  onComfortable: (next: boolean) => void;
};
export function ReadingPreferences({ scale, onScale, comfortable, onComfortable }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Type className="size-4 text-brand" aria-hidden="true" />
          Text size
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease text size"
            onClick={() => onScale(Math.max(0.85, Math.round((scale - 0.05) * 100) / 100))}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <span className="w-14 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Increase text size"
            onClick={() => onScale(Math.min(1.4, Math.round((scale + 0.05) * 100) / 100))}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <AlignJustify className="size-4 text-brand" aria-hidden="true" />
          Comfortable spacing
        </span>
        <span className="relative inline-flex">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={comfortable}
            onChange={(e) => onComfortable(e.target.checked)}
          />
          <span className="block h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-brand" />
          <span className="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow transition-transform peer-checked:translate-x-5" />
        </span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Looser line height and letter spacing for easier reading.
      </p>
    </div>
  );
}