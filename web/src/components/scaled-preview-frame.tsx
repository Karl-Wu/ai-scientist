import type { ComponentProps } from "react";

type PreviewFrameProps = Pick<ComponentProps<"iframe">, "srcDoc" | "title" | "sandbox" | "ref"> & { zoom: number };

/** Change the viewport and visual scale without replacing the frame document. */
export function ScaledPreviewFrame({ srcDoc, title, sandbox, zoom, ref }: PreviewFrameProps) {
  const viewportSize = (100 / zoom) + "%";
  return <div className="h-full min-h-0 overflow-hidden bg-white">
    <iframe ref={ref} title={title} sandbox={sandbox} referrerPolicy="no-referrer" srcDoc={srcDoc}
      className="block border-0" style={{
        width: viewportSize,
        height: viewportSize,
        transform: "scale(" + zoom + ")",
        transformOrigin: "top left",
      }} />
  </div>;
}
