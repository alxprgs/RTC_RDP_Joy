export type ButtonMode = "tap" | "hold";

export type CustomButton = {
  id: string;
  title: string;
  action: string;
  power: number; 
  durationMs: number;
  mode: ButtonMode;
};

export type ServerAction = { name: string; title: string };
