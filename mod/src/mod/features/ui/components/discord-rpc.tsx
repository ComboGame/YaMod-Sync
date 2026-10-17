import { PanelSection, StoredSwitch } from "@ui/components/ui/setting-row";

export function DiscordRPC() {
  return (
    <PanelSection title="Discord">
      <StoredSwitch storageKey="discordRPC/enabled" fallback={true} title="Показывать, что играет" hint="Трек и исполнитель в профиле Discord" />
      <StoredSwitch storageKey="discordRPC/showModButton" fallback={true} title="Кнопка «Яндекс Музыка Sync» в статусе" />
    </PanelSection>
  );
}
