const NO_CAR_NUMBER = "----";

// QUIRK(topis): plate numbers may come padded with spaces; the app shows the last four digits.
export function toCarNumber(plateNo: string | undefined): string {
  return (plateNo || "").trim().slice(-4) || NO_CAR_NUMBER;
}
