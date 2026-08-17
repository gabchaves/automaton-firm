/**
 * Provider auth scheme: a provider config with authScheme "Key" must resolve
 * a model whose client uses `Authorization: Key <token>` (for fal.ai's
 * OpenRouter proxy) instead of the OpenAI-default `Bearer`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../inference/provider-registry.js";

describe("provider authScheme", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });

  it("carries authScheme 'Key' from config through to the resolved provider", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "authscheme-"));
    const cfgPath = path.join(dir, "providers.json");
    writeFileSync(cfgPath, JSON.stringify({
      providers: [{
        id: "local",
        name: "fal",
        baseUrl: "https://fal.run/openrouter/router/openai/v1",
        apiKeyEnvVar: "FAL_API_KEY",
        authScheme: "Key",
        models: [{ id: "google/gemini-3-flash-preview", tier: "fast", contextWindow: 1000, maxOutputTokens: 100, costPerInputToken: 0, costPerOutputToken: 0, supportsTools: true, supportsVision: false, supportsStreaming: true }],
        maxRequestsPerMinute: 100, maxTokensPerMinute: 100000, priority: 10, enabled: true,
      }],
      tierDefaults: { fast: { preferredProvider: "local", fallbackOrder: ["local"] } },
    }));

    process.env.FAL_API_KEY = "test-fal-key";
    const registry = ProviderRegistry.fromConfig(cfgPath);
    const resolved = registry.resolveModel("fast");

    expect(resolved.provider.authScheme).toBe("Key");
    expect(resolved.model.id).toBe("google/gemini-3-flash-preview");
    // The OpenAI client was constructed without throwing (custom header path).
    expect(resolved.client).toBeDefined();
  });
});
