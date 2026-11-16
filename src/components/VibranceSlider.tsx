import { Capabilities, DRIVER_MAX, SUPER_MAX } from "../lib/types";
import { Mark, Slider } from "./Slider";

export function vibranceMax(c: Capabilities) {
  return c.superMethod !== "none" ? SUPER_MAX : DRIVER_MAX;
}

export function vibranceMarks(max: number): Mark[] {
  return max > DRIVER_MAX
    ? [
        { value: 0, label: "0%" },
        { value: 50, label: "50%", hint: "normal" },
        { value: 100, label: "100%", hint: "limite do driver" },
        { value: 200, label: "200%", hint: "super" },
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
  const max = vibranceMax(props.capabilities);
  return (
    <Slider
      value={Math.min(props.value, max)}
      max={max}
      onChange={props.onChange}
      marks={vibranceMarks(max)}
      superFrom={max > DRIVER_MAX ? DRIVER_MAX : undefined}
      label={props.label ?? "Digital Vibrance"}
      disabled={props.disabled}
    />
  );
}
