import { test } from "node:test";
import assert from "node:assert/strict";
import { oldHostRedirect, publicBaseFor, slugLike, shortBase } from "../hosts.js";

test("old garage.jmsurf.co.ke addresses move to jmsurfgarage.co.ke", () => {
  assert.equal(oldHostRedirect("garage.jmsurf.co.ke", "/pricing", "/pricing?x=1"), "https://jmsurfgarage.co.ke/pricing?x=1");
  assert.equal(oldHostRedirect("www.garage.jmsurf.co.ke", "/", "/"), "https://jmsurfgarage.co.ke/");
  assert.equal(oldHostRedirect("app.garage.jmsurf.co.ke", "/sales/invoices", "/sales/invoices"), "https://app.jmsurfgarage.co.ke/sales/invoices");
  assert.equal(oldHostRedirect("admin.garage.jmsurf.co.ke", "/", "/"), "https://admin.jmsurfgarage.co.ke/admin");
  assert.equal(oldHostRedirect("dash.garage.jmsurf.co.ke", "/admin/domains", "/admin/domains"), "https://admin.jmsurfgarage.co.ke/admin/domains");
  // A company's old address: customer pages under app.…/<slug>; sign-in links to the one sign-in.
  assert.equal(oldHostRedirect("acme.garage.jmsurf.co.ke", "/t/abc", "/t/abc"), "https://app.jmsurfgarage.co.ke/acme/t/abc");
  assert.equal(oldHostRedirect("acme.garage.jmsurf.co.ke", "/", "/"), "https://app.jmsurfgarage.co.ke/acme");
  assert.equal(oldHostRedirect("acme.garage.jmsurf.co.ke", "/auth/handoff", "/auth/handoff"), "https://app.jmsurfgarage.co.ke/auth/handoff");
  assert.equal(oldHostRedirect("acme.garage.jmsurf.co.ke", "/login", "/login?x=1"), "https://app.jmsurfgarage.co.ke/login?x=1");
});

test("callbacks and build files keep answering on the old addresses", () => {
  for (const p of ["/api/payments/daraja/callback", "/api/garage/i/whatsapp/webhook", "/assets/index.js", "/.well-known/jmsurfgarage-verify/x", "/sw.js"]) {
    assert.equal(oldHostRedirect("garage.jmsurf.co.ke", p, p), null, p);
    assert.equal(oldHostRedirect("acme.garage.jmsurf.co.ke", p, p), null, p);
  }
  assert.equal(oldHostRedirect("jmsurfgarage.co.ke", "/", "/"), null);
  assert.equal(oldHostRedirect("mygarage.co.ke", "/", "/"), null);
});

test("customer pages: own domain first, else app.jmsurfgarage.co.ke/<slug>", () => {
  assert.equal(publicBaseFor("acme", ""), "https://app.jmsurfgarage.co.ke/acme");
  assert.equal(publicBaseFor("acme", "acmemotors.co.ke"), "https://acmemotors.co.ke");
  assert.equal(shortBase(publicBaseFor("acme")), "app.jmsurfgarage.co.ke/acme");
  assert.equal(slugLike("acme-motors"), true);
  assert.equal(slugLike("dashboard"), false);
  assert.equal(slugLike("t"), false);
});
