import { createProvider, envApiKeyAuth, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

/**
 * Local, OpenAI-compatible inference servers (mlx-dspark, Ollama, LM Studio, vLLM, ...)
 * are not part of Pi's built-in catalog. Register them here so both the onboarding
 * catalog (pi-models.ts) and the runtime (pi-runtime.ts) see the same provider/model set.
 */
export function registerLocalProviders(models: MutableModels): void {
  const baseUrl = process.env.MLX_DSPARK_BASE_URL;
  if (!baseUrl) return;

  const modelId = "mlx-community/Qwen3.8-27B-4bit";
  const model: Model<"openai-completions"> = {
    id: modelId,
    name: "Qwen3.8-27B-4bit (mlx-dspark, local)",
    api: "openai-completions",
    provider: "mlx-dspark",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 8000,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };

  const provider = createProvider({
    id: "mlx-dspark",
    name: "mlx-dspark (local Qwen)",
    baseUrl,
    auth: { apiKey: envApiKeyAuth("mlx-dspark local API key", ["MLX_DSPARK_API_KEY"]) },
    models: [model],
    api: openAICompletionsApi(),
  });

  models.setProvider(provider);
  installDsparkAutoReload(baseUrl, modelId, () => process.env.MLX_DSPARK_API_KEY);
}

/**
 * mlx-dspark's idle_watcher unloads the model after 15 minutes of inactivity
 * (see ~/.claude/skills/local-llm/SKILL.md), after which requests 503 with
 * "no model is loaded" until something calls POST /admin/load. Pi's OpenAI-
 * completions transport has no retry hook for this, so we patch fetch once,
 * scoped to mlx-dspark's origin only: on a 503 from that origin, reload the
 * model and replay the original request exactly once (same pattern as
 * build_local.py's llm() helper, which this setup already relies on).
 */
let dsparkAutoReloadInstalled = false;

function installDsparkAutoReload(
  baseUrl: string,
  modelId: string,
  getApiKey: () => string | undefined,
): void {
  if (dsparkAutoReloadInstalled) return;
  dsparkAutoReloadInstalled = true;

  const origin = new URL(baseUrl).origin;
  const originalFetch = globalThis.fetch.bind(globalThis);
  let reloadInFlight: Promise<boolean> | null = null;

  function requestUrl(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  async function reloadModel(): Promise<boolean> {
    reloadInFlight ??= (async () => {
      try {
        const apiKey = getApiKey();
        const response = await originalFetch(`${origin}/admin/load`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model: modelId, mode: "auto" }),
          signal: AbortSignal.timeout(60_000),
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        reloadInFlight = null;
      }
    })();
    return reloadInFlight;
  }

  globalThis.fetch = (async (input, init) => {
    if (!requestUrl(input).startsWith(origin)) return originalFetch(input, init);

    const response = await originalFetch(input, init);
    if (response.status !== 503) return response;

    const reloaded = await reloadModel();
    if (!reloaded) return response;

    return originalFetch(input, init);
  }) as typeof fetch;
}
