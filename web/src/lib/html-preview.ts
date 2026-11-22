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

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Keep untrusted HTML in the inner srcdoc attribute, not in the policy document. */
export function htmlPreviewDocument(html: string, title: string): string {
  return "<!doctype html><html><head><meta charset=\"utf-8\">" +
    '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_POLICY + '">' +
    '<meta name="referrer" content="no-referrer">' +
    "<style>html,body{height:100%;margin:0}iframe{display:block;width:100%;height:100%;border:0}</style>" +
    '</head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="' + attribute(title) +
    '" srcdoc="' + attribute(html) + '"></iframe></body></html>';
}

export function htmlPreviewPath(path: string, projectId: string): string {
  return "/html-preview?" + new URLSearchParams({ path, project: projectId }).toString();
}
