/** Provider codes only. Never propagate arbitrary Meta error messages or tokens. */
export function isGraphPermissionError(code: number | null): boolean {
  // Meta's current Graph error guide groups 200–299 as API Permission.
  return code === 10 || (code !== null && code >= 200 && code <= 299);
}

export const instagramPermissionRepairMessage = "Meta denied Instagram read permission; verify the existing read grants, selected Page/account link and app access in Meta, then reauthorize if required. No posts were read";
