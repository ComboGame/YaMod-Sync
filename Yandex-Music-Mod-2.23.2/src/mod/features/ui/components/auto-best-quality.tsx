import { PanelSection, StoredSwitch } from "@ui/components/ui/setting-row";

export function AutoBestQuality() {
  return (
    <PanelSection title="Звук">
      <StoredSwitch
        storageKey="autoBestQuality/enabled"
        fallback={true}
        title="Высокое качество по умолчанию"
        hint="Выбирать лучшее качество, доступное по вашей подписке"
      />
    </PanelSection>
  );
}
