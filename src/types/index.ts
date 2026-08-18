export type HudStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "enhancing"
  | "editing"
  | "success"
  | "error"
  | "cancelled";

export interface HudState {
  status: HudStatus;
  message: string;
}

export const TRIGGER_MODE_VALUES = ["hold", "toggle"] as const;
export type TriggerMode = (typeof TRIGGER_MODE_VALUES)[number];

export interface HudTargetPosition {
  x: number;
  y: number;
  monitorKey: string;
  /** 座標空間：Windows 為 "physical"（用 PhysicalPosition，DPI-safe），其餘為 "logical"。 */
  space: "physical" | "logical";
}
