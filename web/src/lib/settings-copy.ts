import type { Translate } from "./translations";

/** Localize server-supplied settings metadata without changing provider IDs or saved values. */
export function settingsCopy(t: Translate, message: string): string {
  const direct = t(message);
  if (direct !== message) return direct;
  const patterns: [RegExp, string, string[]][] = [
    [/^(.+) API key( \(optional\))?$/, "{provider} API key{optional}", ["provider", "optional"]],
    [/^Direct access to (.+) models with your own API key\.$/, "Direct access to {provider} models with your own API key.", ["provider"]],
    [/^Connected · (\d+) tools?$/, "Connected · {count} tools", ["count"]],
    [/^Failed to load(.*) \((\d+)\)$/, "Could not load {subject} ({status})", ["subject", "status"]],
    [/^Save failed \((\d+)\)$/, "Save failed ({v0})", ["v0"]],
    [/^Server "(.+)" needs a base URL$/, 'Server "{v0}" needs a base URL', ["v0"]],
    [/^Server "(.+)" needs at least one model id$/, 'Server "{v0}" needs at least one model id', ["v0"]],
    [/^Model "(.+)" has a non-numeric field$/, 'Model "{v0}" has a non-numeric field', ["v0"]],
    [/^Failed(: .*)?$/, "Failed{v0}", ["v0"]],
  ];
  for (const [pattern, template, names] of patterns) {
    const match = message.match(pattern);
    if (match && t(template) !== template) return t(template, Object.fromEntries(names.map((name, i) => [name, name === "optional" ? (match[i + 1] ? t("(optional)") : "") : match[i + 1] ?? ""])));
  }
  return direct;
}
