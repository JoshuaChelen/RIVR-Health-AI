/**
 * Auto-format a DOB text input as MM/DD/YYYY, inserting slashes as you type.
 * @param next  the new raw string from onChangeText
 * @param prev  the previous value (to detect deletion)
 */
export function formatDobAsTyped(next: string, prev: string): string {
  const isDeleting = next.length < prev.length;
  if (isDeleting) return next;
  const digits = next.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

/**
 * Parse MM/DD/YYYY → ISO YYYY-MM-DD.
 * Returns null for invalid input or implausible ages (outside 0–130 years).
 */
export function parseDob(input: string): string | null {
  const cleaned = input.replace(/\s/g, "");
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, m, d, y] = match;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const age = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (age < 0 || age > 130) return null;
  return iso;
}

/** ISO YYYY-MM-DD → MM/DD/YYYY for text inputs. */
export function dobIsoToInput(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** ISO YYYY-MM-DD → human-readable "Month D, YYYY". */
export function dobIsoToDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

/** Returns age in whole years from an ISO YYYY-MM-DD date string. */
export function computeAge(iso: string): number {
  const birth = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * Auto-format phone digits as (XXX) XXX-XXXX for US numbers.
 * International numbers starting with "+" are passed through unchanged.
 * Strips non-digits and caps at 10 digits for US format.
 */
export function formatPhoneInput(raw: string): string {
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
