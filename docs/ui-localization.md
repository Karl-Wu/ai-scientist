# UI localization

The UI currently supports English (`en`) and Simplified Chinese (`zh-CN`).
Choose the language in Settings → Appearance → Language, or in the workflow
catalogue. Both controls change the same app-wide preference, persisted in
`kady-settings.json` and cached in the browser under `kady:locale`. When no
preference exists, Chinese browser locales select Simplified Chinese and other
browser locales select English. Other tabs on the same origin follow changes;
other browsers read the app preference when opening or reloading the page.

## Adding UI copy

Use `useT()` in client components and `t("English source message")` at the point
of display. Add the corresponding Chinese value in
`web/src/data/locales/zh-CN.json`. English source messages act as translation keys;
an absent translation falls back to that source text. `useT()` defaults to English
for standalone components outside the app provider. Language controls require
`I18nProvider`.

Use named parameters for variable text, for example:

```tsx
const t = useT();
t("Delete “{name}”?", { name: project.name });
```

Translate labels when rendering, including labels in module-level arrays, and
include `t` in memo/callback dependencies when the callback uses translated copy.
Use `useLocale()` for date/number formatting. Keep stable identifiers, API values,
status comparisons, MIME types such as `Files`, file paths, keyboard values, and
model prompts in their original form. Do not translate user project/session names,
model-generated text, file contents, or raw tool output. React escapes parameter
values; the translator never inserts HTML.

The first UI pass covers the workspace shell, project/session navigation,
composer controls, Files controls and preview chrome, Journal navigation and
filters, Tasks, settings navigation and Appearance. The existing workflow
catalogue translations remain in `web/src/data/workflow-locales/zh-CN.json`;
workflow execution prompts are unchanged. Detailed provider/service/project
settings, specialized scientific viewers and deeper research dialogs can be
translated incrementally using the same infrastructure.

Tests cover interpolation parity, fallback, saved preferences, browser-language
fallback, live switching, cross-tab updates, storage failures, and native file
uploads with a Chinese UI.

Language preferences are saved app-wide as `defaults.locale` in `kady-settings.json` through `/settings/defaults`. Browser localStorage is a startup/offline cache; the app setting wins on load, so Edge, the in-app browser, `localhost` and `127.0.0.1` share the choice. Existing explicit browser preferences migrate if the app has no saved language. Browser-language detection is never persisted automatically.
