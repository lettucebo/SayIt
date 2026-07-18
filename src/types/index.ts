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

export type TriggerMode = "hold" | "toggle";

export interface HudTargetPosition {
  x: number;
  y: number;
  monitorKey: string;
  /** 座標空間：Windows 為 "physical"（用 PhysicalPosition，DPI-safe），其餘為 "logical"。 */
  space: "physical" | "logical";
}
