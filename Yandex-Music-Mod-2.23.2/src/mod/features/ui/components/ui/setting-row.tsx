import { useEffect, useId, useState, type ReactNode } from "react";
import { Switch } from "@ui/components/ui/switch";
import { cn } from "@ui/lib/utils";

/** Раздел панели: заголовок и строки под ним, без отдельной коробки на каждую настройку. */
export function PanelSection(props: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("px-5 py-4", props.className)}>
      <h3 className="text-foreground text-[15px] font-bold">{props.title}</h3>
      {props.description && <p className="text-muted-foreground mt-1 text-[13px] leading-snug">{props.description}</p>}
      <div className="mt-2 flex flex-col">{props.children}</div>
    </section>
  );
}

/** Строка настройки: что это и что меняет — слева, переключатель или поле — справа. */
export function SettingRow(props: { title: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <label htmlFor={props.htmlFor} className="flex min-w-0 cursor-pointer flex-col">
        <span className="text-foreground text-sm">{props.title}</span>
        {props.hint && <span className="text-muted-foreground text-[13px] leading-snug">{props.hint}</span>}
      </label>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}

/**
 * Переключатель, который сам хранит своё значение в настройках мода.
 * `fallback` — значение, пока пользователь ничего не выбирал.
 */
export function StoredSwitch(props: { storageKey: string; title: string; hint?: string; fallback: boolean }) {
  const id = useId();
  const [checked, setChecked] = useState(props.fallback);

  useEffect(() => {
    void window.yandexMusicMod.getStorageValue(props.storageKey).then((value) => {
      setChecked(typeof value === "boolean" ? value : props.fallback);
    });
  }, [props.storageKey, props.fallback]);

  return (
    <SettingRow title={props.title} hint={props.hint} htmlFor={id}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(value) => {
          setChecked(value);
          window.yandexMusicMod.setStorageValue(props.storageKey, value);
        }}
      />
    </SettingRow>
  );
}

/** Переключатель вкладок в виде «таблеток», как фильтры в самой Яндекс Музыке. */
export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1.5">
      {props.options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "h-8 cursor-pointer rounded-full px-3.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            props.value === option.value
              ? "bg-foreground text-background"
              : "bg-card text-foreground hover:bg-accent/60",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
