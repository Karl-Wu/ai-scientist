/** Exact runtime snapshot: never silently execute a changed CDN build. */
export const OFFICE_BUILD = "zeta-2025-05-13";
export const OFFICE_ASSETS: Record<string, { sha256: string; size: number; type: string; source?: string }> = {
  "soffice.js": { sha256: "5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77", size: 858124, type: "text/javascript" },
  "soffice.data.js.metadata": { sha256: "5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3", size: 0, type: "application/json" },
  "soffice.wasm": { sha256: "9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4", size: 161667499, type: "application/wasm" },
  "soffice.data": { sha256: "3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c", size: 99520604, type: "application/octet-stream" },
  "NotoSansSC-Regular.ttf": {
    sha256: "450625c8d46ab3df97b7904ded955ec2746d17ec76740cb1e91d1ba63a0f89af",
    size: 10540644,
    type: "font/ttf",
    source: "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf",
  },
};
