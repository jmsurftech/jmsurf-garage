import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTests, onTill, quiet, setTillBusy, takeReloadTry, typing } from "./staleBuildReload";

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/dashboard");
  __resetForTests();
});
afterEach(() => { document.body.innerHTML = ""; });

describe("onTill", () => {
  it("knows the till and its customer display, on clean and slug paths", () => {
    expect(onTill("/pos")).toBe(true);
    expect(onTill("/pos/display/abc")).toBe(true);
    expect(onTill("/acme/pos")).toBe(true);
    expect(onTill("/dashboard")).toBe(false);
    expect(onTill("/positions")).toBe(false);
    expect(onTill("/reports/pos-summary")).toBe(false);
  });
});

describe("quiet", () => {
  it("is quiet on an ordinary page", () => {
    expect(quiet()).toBe(true);
  });

  it("waits on the till and while a sale is reported", () => {
    window.history.replaceState({}, "", "/pos");
    expect(quiet()).toBe(false);
    window.history.replaceState({}, "", "/dashboard");
    setTillBusy(true);
    expect(quiet()).toBe(false);
    setTillBusy(false);
    expect(quiet()).toBe(true);
  });

  it("waits while a pop-up is open", () => {
    document.body.innerHTML = '<div role="dialog">Edit job card</div>';
    expect(quiet()).toBe(false);
  });

  it("waits while a half-typed field has focus, not an empty one or a checkbox", () => {
    document.body.innerHTML = '<input id="a" type="text"><input id="b" type="checkbox" checked>';
    const a = document.getElementById("a") as HTMLInputElement;
    a.focus();
    expect(typing()).toBe(false);
    a.value = "KCA 1";
    expect(typing()).toBe(true);
    expect(quiet()).toBe(false);
    (document.getElementById("b") as HTMLInputElement).focus();
    expect(typing()).toBe(false);
  });
});

describe("takeReloadTry", () => {
  it("allows 3 tries in 2 minutes, then more once they age out", () => {
    const t = 1_000_000;
    expect(takeReloadTry(t)).toBe(true);
    expect(takeReloadTry(t + 1_000)).toBe(true);
    expect(takeReloadTry(t + 2_000)).toBe(true);
    expect(takeReloadTry(t + 3_000)).toBe(false);
    expect(takeReloadTry(t + 121_000)).toBe(true);
  });
});
