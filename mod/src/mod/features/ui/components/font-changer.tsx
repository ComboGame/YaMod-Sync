import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { PanelSection, SettingRow, StoredSwitch } from "@ui/components/ui/setting-row";

const availableFonts = ["JetBrains Mono", "Lato", "Inter", "Rubik", "Ubuntu", "Roboto Slab", "Quicksand", "Pacifico"];
// Тот же ключ читает features/font-changer.
const FONT_KEY = "font-changer/savedFont";

export function FontChanger() {
  const [enabled, setEnabled] = useState(false);
  const [font, setFont] = useState(availableFonts[0]!);

  useEffect(() => {
    void window.yandexMusicMod.getStorageValue(FONT_KEY).then((saved) => saved && setFont(saved));
    void window.yandexMusicMod.getStorageValue("font-changer/enabled").then((on) => setEnabled(on === true));
    return window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "font-changer/enabled") setEnabled(value === true);
    });
  }, []);

  return (
    <PanelSection title="Шрифт">
      <StoredSwitch storageKey="font-changer/enabled" fallback={false} title="Свой шрифт в приложении" />
      {enabled && (
        <SettingRow title="Шрифт">
          <Select
            value={font}
            onValueChange={(value: string) => {
              setFont(value);
              window.yandexMusicMod.setStorageValue(FONT_KEY, value);
            }}
          >
            <SelectTrigger className="w-44 text-foreground">
              <SelectValue placeholder="Выбрать шрифт" />
            </SelectTrigger>
            <SelectContent>
              {availableFonts.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}
    </PanelSection>
  );
}
