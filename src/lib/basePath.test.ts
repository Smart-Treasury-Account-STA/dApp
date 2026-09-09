import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module reads the env once at import time, so each case re-imports it.
async function loadApiUrl() {
  vi.resetModules();
  const { apiUrl } = await import("./basePath");
  return apiUrl;
}

describe("apiUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the path unchanged when no base path is configured", async () => {
    const apiUrl = await loadApiUrl();
    expect(apiUrl("/api/treasuries")).toBe("/api/treasuries");
  });

  it("prefixes the path with NEXT_PUBLIC_BASE_PATH", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/app");
    const apiUrl = await loadApiUrl();
    expect(apiUrl("/api/relayer/session")).toBe("/app/api/relayer/session");
  });

  it("keeps query strings intact", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/app");
    const apiUrl = await loadApiUrl();
    expect(apiUrl("/api/treasuries?owner=GABC")).toBe(
      "/app/api/treasuries?owner=GABC",
    );
  });
});
