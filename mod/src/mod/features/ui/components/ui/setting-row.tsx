import { useEffect, useId, useState, type ReactNode } from "react";
import { Switch } from "@ui/components/ui/switch";
import { cn } from "@ui/lib/utils";

/** Карточка — слой над фоном панели, как карточки в Modrinth App. */
export function Card(props: { children: ReactNode; className?: string; tone?: "plain" | "brand" }) {
  return (
    <section
      className={cn(
        "rounded-lg border border-surface-4 p-4 shadow-[var(--ms-shadow-card)]",
        props.tone === "brand" ? "bg-surface-3 bg-[image:var(--ms-brand-gradient)]" : "bg-surface-3",
        props.className,
      )}
    >
      {props.children}
    </section>
  );
}

/** Заголовок карточки: что это, и при необходимости одно пояснение под ним. */
export function CardTitle(props: { title: string; description?: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-strong text-[15px] font-bold">{props.title}</h3>
        {props.description && <p className="text-muted-foreground mt-0.5 text-[13px] leading-snug">{props.description}</p>}
      </div>
      {props.aside}
    </div>
  );
}

/** Карточка с заголовком и строками настроек под ним. */
export function PanelSection(props: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={props.className}>
      <CardTitle title={props.title} description={props.description} />
      <div className="flex flex-col">{props.children}</div>
    </Card>
  );
}

/** Строка настройки: что это и что меняет — слева, переключатель или поле — справа. */
export function SettingRow(props: { title: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-surface-4 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <label htmlFor={props.htmlFor} className="flex min-w-0 cursor-pointer flex-col">
        <span className="text-strong text-sm">{props.title}</span>
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
