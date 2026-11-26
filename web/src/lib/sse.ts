/** Read JSON `data:` lines from the app's event streams. Return true from the consumer to stop. */
export async function consumeSse<Frame>(response: Response, onFrame: (frame: Frame) => boolean | void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";

  function consumeLine(line: string) {
    if (!line.startsWith("data:")) return;
    let frame: Frame;
    try { frame = JSON.parse(line.slice(5).trim()) as Frame; }
    catch { return; }
    return onFrame(frame);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (consumeLine(line)) {
          await reader.cancel();
          return;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
