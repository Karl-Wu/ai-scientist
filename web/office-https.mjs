export function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1";
}

export function officeHttpsRedirect(request, port) {
  if (!port || !request.headers.host) return null;
  let target;
  try {
    target = new URL(request.url ?? "/", `http://${request.headers.host}`);
  } catch {
    return null;
  }
  if (target.pathname !== "/office" && !target.pathname.startsWith("/office/")) return null;
  if (isLoopbackHostname(target.hostname.replace(/^\[|\]$/g, "").toLowerCase())) return null;
  target.protocol = "https:";
  target.port = String(port);
  return target;
}
