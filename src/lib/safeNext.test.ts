import { describe, it, expect } from "vitest";
import { safeNextPath, buildNextQuery } from "./safeNext";

describe("safeNextPath", () => {
  it("accepts a same-origin relative path", () => {
    expect(safeNextPath("/oauth/consent?authorization_id=abc")).toBe(
      "/oauth/consent?authorization_id=abc"
    );
    expect(safeNextPath("/my-store/dashboard")).toBe("/my-store/dashboard");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeNextPath("//evil.com/path")).toBeNull();
    expect(safeNextPath("http://evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
  });

  it("rejects empty / nullish / whitespace values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("/ has space")).toBeNull();
    expect(safeNextPath("/\nfoo")).toBeNull();
  });

  it("builds a proper next query string", () => {
    expect(buildNextQuery("/foo?bar=1")).toBe("?next=%2Ffoo%3Fbar%3D1");
    expect(buildNextQuery("//evil")).toBe("");
    expect(buildNextQuery(null)).toBe("");
  });
});
