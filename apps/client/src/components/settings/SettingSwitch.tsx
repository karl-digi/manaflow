import { Switch } from "@heroui/react";
import type { ReactNode } from "react";
import { SettingRow } from "./SettingRow";

interface SettingSwitchProps {
  label: ReactNode;
  description?: ReactNode;
  isSelected: boolean;
  onValueChange: (value: boolean) => void;
  ariaLabel: string;
  isDisabled?: boolean;
  noBorder?: boolean;
}

export function SettingSwitch({
  label,
  description,
  isSelected,
  onValueChange,
  ariaLabel,
  isDisabled,
  noBorder,
}: SettingSwitchProps) {
  return (
    <SettingRow label={label} description={description} noBorder={noBorder}>
      <div className="flex justify-start sm:justify-end">
        <Switch
          aria-label={ariaLabel}
          size="sm"
          color="primary"
          isSelected={isSelected}
          isDisabled={isDisabled}
          onValueChange={onValueChange}
        />
      </div>
    </SettingRow>
  );
}
