import { describe, expect, it } from "vitest";

import { isLoopbackHostname, officeHttpsRedirect } from "../../office-https.mjs";

describe("office HTTPS redirects", () => {
  it("redirects remote HTTP office URLs while preserving the path and query", () => {
    const target = officeHttpsRedirect(
      { headers: { host: "139.9.229.238:9018" }, url: "/office?path=user_data/demo.xlsx&project=default" },
      9019,
    );
    expect(target?.href).toBe("https://139.9.229.238:9019/office?path=user_data/demo.xlsx&project=default");
  });

  it("keeps localhost on HTTP so local development remains a secure context", () => {
    expect(officeHttpsRedirect({ headers: { host: "localhost:3000" }, url: "/office?path=a.xlsx" }, 9019)).toBeNull();
    expect(isLoopbackHostname("::1")).toBe(true);
  });

  it("does not redirect unrelated routes or malformed hosts", () => {
    expect(officeHttpsRedirect({ headers: { host: "example.com" }, url: "/" }, 9019)).toBeNull();
    expect(officeHttpsRedirect({ headers: {}, url: "/office" }, 9019)).toBeNull();
    expect(officeHttpsRedirect({ headers: { host: "example.com" }, url: "/office" }, null)).toBeNull();
  });
});
