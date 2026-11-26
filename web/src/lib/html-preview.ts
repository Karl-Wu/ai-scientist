// The file runs in the inner, opaque-origin frame. The outer document owns
// the policy, so file scripts cannot change it or navigate the frame to a URL.
const PREVIEW_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "frame-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Fragment links in srcdoc resolve against the embedding page by default.
// Update the report's own URL so its hashchange handlers can reveal hidden sections.
const FRAGMENT_NAVIGATION = `<script>
window.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey) return;
  const link = event.target instanceof Element && event.target.closest('a[href^="#"]');
  if (!link || link.hasAttribute('download')) return;
  const target = link.getAttribute('target');
  if (target && target.toLowerCase() !== '_self') return;
  event.preventDefault();
  location.hash = link.getAttribute('href');
});
</script>`;

// The host validates the sender and resolves HTML links inside the current project.
const REPORT_NAVIGATION = `<script>
(() => {
const reportHost = window.parent.parent;
const notifyHost = (kind, value) => reportHost.postMessage({kind, value}, '*');
window.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
      event.altKey || event.shiftKey) return;
  const link = event.target instanceof Element && event.target.closest('a[href]');
  if (!link || link.hasAttribute('download')) return;
  const href = link.getAttribute('href');
  if (!href || (!href.startsWith('#') && !/\\.html?(?:[#?]|$)/i.test(href))) return;
  event.preventDefault();
  if (href.startsWith('#')) location.hash = href;
  else notifyHost('report-link', href);
});
window.addEventListener('message', (event) => {
  if (event.source !== reportHost || event.data?.kind !== 'report-location') return;
  const hash = event.data.value;
  if (typeof hash === 'string' && (!hash || hash.startsWith('#')) && location.hash !== hash)
    location.hash = hash;
});
window.addEventListener('hashchange', () => notifyHost('report-hash', location.hash));
window.addEventListener('load', () => notifyHost('report-ready', ''));
})();
</script>`;

// Install the fixed preview script before the report's own CSP takes effect.
// Preserve the doctype and explicit head, including any attributes on them.
const HTML_TRIVIA = String.raw`(?:\s|<!--[\s\S]*?-->)*`;
const END_OF_TAG = `(?:[^>"']|"[^"]*"|'[^']*')*>`;
const HTML_PROLOGUE = new RegExp(
  `^${HTML_TRIVIA}(?:<!doctype\\s${END_OF_TAG}${HTML_TRIVIA})?` +
  `(?:<html(?=\\s|>)${END_OF_TAG}${HTML_TRIVIA})?(?:<head(?=\\s|>)${END_OF_TAG})?`,
  "i",
);

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Keep untrusted HTML in the inner srcdoc attribute, not in the policy document. */
export function htmlPreviewDocument(html: string, title: string, navigation = false): string {
  const report = html.replace(HTML_PROLOGUE, (prologue) => prologue + (navigation ? REPORT_NAVIGATION : FRAGMENT_NAVIGATION));
  return "<!doctype html><html><head><meta charset=\"utf-8\">" +
    '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_POLICY + '">' +
    '<meta name="referrer" content="no-referrer">' +
    "<style>html,body{height:100%;margin:0}iframe{display:block;width:100%;height:100%;border:0}</style>" +
    '</head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="' + attribute(title) +
    '" srcdoc="' + attribute(report) + '"></iframe></body></html>';
}

export function htmlPreviewPath(path: string, projectId: string): string {
  return "/html-preview?" + new URLSearchParams({ path, project: projectId }).toString();
}
