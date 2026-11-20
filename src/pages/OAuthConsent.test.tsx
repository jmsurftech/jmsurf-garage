import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OAuthConsent from "./OAuthConsent";

// --- Mock Supabase client used by OAuthConsent ---
const getSession = vi.fn();
const getAuthorizationDetails = vi.fn();
const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      oauth: {
        getAuthorizationDetails: (id: string) => getAuthorizationDetails(id),
        approveAuthorization: (id: string) => approveAuthorization(id),
        denyAuthorization: (id: string) => denyAuthorization(id),
      },
    },
  },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OAuthConsent />
    </MemoryRouter>
  );
}

const originalLocation = window.location;

beforeEach(() => {
  getSession.mockReset();
  getAuthorizationDetails.mockReset();
  approveAuthorization.mockReset();
  denyAuthorization.mockReset();

  // JSDOM: make window.location.href assignable and observable
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: "http://localhost/",
      pathname: "/oauth/consent",
      search: "?authorization_id=abc-123",
    },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
});

describe("OAuthConsent", () => {
  it("redirects unauthenticated users to /login with next preserved", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    renderAt("/oauth/consent?authorization_id=abc-123");

    await waitFor(() => {
      expect(window.location.href).toContain("/login?next=");
      expect(window.location.href).toContain(
        encodeURIComponent("/oauth/consent")
      );
      expect(window.location.href).toContain(
        encodeURIComponent("authorization_id=abc-123")
      );
    });
  });

  it("shows a specific error when authorization_id is missing", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    renderAt("/oauth/consent");

    expect(await screen.findByText(/Invalid authorization link/i)).toBeInTheDocument();
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it("shows an expired-authorization message when the server rejects the id", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getAuthorizationDetails.mockResolvedValue({
      data: null,
      error: { message: "authorization not found or expired" },
    });

    renderAt("/oauth/consent?authorization_id=abc-123");

    expect(await screen.findByText(/Authorization expired/i)).toBeInTheDocument();
  });

  it("calls approveAuthorization and redirects when the user approves", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getAuthorizationDetails.mockResolvedValue({
      data: { client: { name: "ChatGPT" } },
      error: null,
    });
    approveAuthorization.mockResolvedValue({
      data: { redirect_url: "https://client.example.com/cb?code=xyz" },
      error: null,
    });

    renderAt("/oauth/consent?authorization_id=abc-123");

    const approve = await screen.findByTestId("oauth-approve");
    fireEvent.click(approve);

    await waitFor(() => {
      expect(approveAuthorization).toHaveBeenCalledWith("abc-123");
      expect(window.location.href).toBe("https://client.example.com/cb?code=xyz");
    });
  });

  it("calls denyAuthorization and redirects when the user denies", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getAuthorizationDetails.mockResolvedValue({
      data: { client: { name: "ChatGPT" } },
      error: null,
    });
    denyAuthorization.mockResolvedValue({
      data: { redirect_to: "https://client.example.com/cb?error=access_denied" },
      error: null,
    });

    renderAt("/oauth/consent?authorization_id=abc-123");

    const deny = await screen.findByTestId("oauth-deny");
    fireEvent.click(deny);

    await waitFor(() => {
      expect(denyAuthorization).toHaveBeenCalledWith("abc-123");
      expect(window.location.href).toBe(
        "https://client.example.com/cb?error=access_denied"
      );
    });
  });
});
