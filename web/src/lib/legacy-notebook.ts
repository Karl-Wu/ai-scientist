export function isRetiredNotebookTool(name: unknown): boolean {
  return name === "notebook" || name === "notebook_search";
}
