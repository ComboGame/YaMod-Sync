import { PanelSection, StoredSwitch } from "@ui/components/ui/setting-row";

export function Devtools() {
  return (
    <PanelSection title="Для разработчиков" description="Рамка окна меняется после перезапуска приложения.">
      <StoredSwitch storageKey="devtools/enabled" fallback={false} title="Режим разработчика" hint="Проверка региона и инструменты отладки в панели" />
      <StoredSwitch storageKey="devtools/systemToolbar" fallback={false} title="Системная рамка окна" />
    </PanelSection>
  );
}
