import { StandaloneHtmlPreview } from "@/components/viewers/standalone-html-preview";

export default async function HtmlPreviewPage({ searchParams }: {
  searchParams: Promise<{ path?: string; project?: string }>;
}) {
  const { path, project } = await searchParams;
  if (typeof path !== "string" || !/\.(html|htm)$/i.test(path) || typeof project !== "string" || !project) {
    return <StandaloneHtmlPreview />;
  }
  return <StandaloneHtmlPreview key={JSON.stringify([project, path])} path={path} projectId={project} />;
}
