/** Reindent valid JSON while leaving number, string, and key tokens intact. */
function indentJson(value: string): string | undefined {
  if (!value.startsWith("{") && !value.startsWith("[")) return undefined;
  try {
    JSON.parse(value);
  } catch {
    return undefined;
  }
  const tokens = value.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) ?? [];
  const lines: string[] = [];
  let depth = 0;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (const [index, token] of tokens.entries()) {
    if (token === "{" || token === "[") {
      // Leave very deeply nested values intact to cap whitespace expansion.
      if (++depth > 40) return undefined;
      lines.push(token + (tokens[index + 1] === (token === "{" ? "}" : "]") ? "" : newline()));
    } else if (token === "}" || token === "]") {
      depth--;
      lines.push((tokens[index - 1] === (token === "}" ? "{" : "[") ? "" : newline()) + token);
    } else if (token === ",") {
      lines.push(token + newline());
    } else {
      lines.push(token === ":" ? ": " : token);
    }
  }
  return lines.join("");
}

/** Accept standalone JSON or complete JSON values following a log prefix. */
export function formatToolOutput(raw: string): string {
  const whole = raw.trim();
  const formatted = indentJson(whole);
  if (formatted !== undefined) return raw.replace(whole, () => formatted);

  return raw.split("\n").map((line) => {
    const start = line.search(/[\[{]/);
    if (start < 0) return line;
    const value = line.slice(start).trimEnd();
    const pretty = indentJson(value);
    if (pretty === undefined) return line;
    return line.slice(0, start) + pretty + line.slice(start + value.length);
  }).join("\n");
}
