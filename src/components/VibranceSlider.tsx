import { T } from "../lib/i18n";
import { Capabilities, DRIVER_MAX, SUPER_MAX } from "../lib/types";
import { useT } from "../lib/useT";
import { Mark, Slider } from "./Slider";

export function vibranceMax(c: Capabilities) {
  return c.superMethod !== "none" ? SUPER_MAX : DRIVER_MAX;
}

export function vibranceMarks(max: number, t: T = (x) => x): Mark[] {
  return max > DRIVER_MAX
    ? [
        { value: 0, label: "0%" },
        { value: 50, label: "50%", hint: t("normal") },
        { value: 100, label: "100%", hint: t("limite do driver") },
        { value: 200, label: "200%", hint: t("super") },
      ]
    : [
        { value: 0, label: "0%" },
        { value: 50, label: "50%" },
        { value: 100, label: "100%" },
      ];
}

export function VibranceSlider(props: {
  value: number;
  onChange(v: number): void;
  capabilities: Capabilities;
  label?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const max = vibranceMax(props.capabilities);
  return (
    <Slider
      value={Math.min(props.value, max)}
      max={max}
      onChange={props.onChange}
      marks={vibranceMarks(max, t)}
      superFrom={max > DRIVER_MAX ? DRIVER_MAX : undefined}
      label={props.label ?? t("Digital Vibrance")}
      disabled={props.disabled}
    />
  );
}
