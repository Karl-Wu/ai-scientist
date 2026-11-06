import { API_BASE } from "./projects";
import { withApiTokenHeader, noteAuthFailure } from "./api-auth";
import { isLocale, type Locale } from "./i18n";

// App-wide preference: no project scope. Use the same backend/auth on every host.
async function request(init: RequestInit) {
  const response = await fetch(`${API_BASE}/settings/defaults`, {
    ...init,
    headers: withApiTokenHeader(new Headers(init.headers)),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  noteAuthFailure(response);
  if (!response.ok) throw new Error("Language settings request failed");
  return response.json();
}

export async function readSavedLocale(): Promise<Locale | null> {
  const data = await request({});
  return isLocale(data.defaults?.locale) ? data.defaults.locale : null;
}

export async function saveLocale(locale: Locale): Promise<void> {
  await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) });
}
