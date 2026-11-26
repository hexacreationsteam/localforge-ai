type ChatMessage = { role: "user" | "assistant"; content: string };
type Payload = {
  modelId?: string;
  messages?: ChatMessage[];
  systemInstruction?: string;
  reasoningDepth?: "fast" | "balanced" | "deep";
  useSearchGrounding?: boolean;
};

const DEFAULT_MODELS = {
  gemini: "gemini-2.5-flash",
  gpt: "gpt-4o",
  grok: "grok-3-mini",
  claude: "claude-sonnet-4-5",
} as const;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function sseFrame(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function providerFor(modelId: string): "gemini" | "gpt" | "grok" | "claude" {
  if (modelId === "gpt") return "gpt";
  if (modelId === "grok") return "grok";
  if (modelId === "claude") return "claude";
  return "gemini";
}

function keyFor(provider: keyof typeof DEFAULT_MODELS): string | undefined {
  const key = {
    gemini: env("GEMINI_API_KEY"),
    gpt: env("OPENAI_API_KEY"),
    grok: env("XAI_API_KEY"),
    claude: env("ANTHROPIC_API_KEY"),
  }[provider];
  return key;
}

function modelFor(provider: keyof typeof DEFAULT_MODELS): string {
  const configured = {
    gemini: env("GEMINI_MODEL"),
    gpt: env("OPENAI_MODEL"),
    grok: env("XAI_MODEL"),
    claude: env("ANTHROPIC_MODEL"),
  }[provider];
  return configured || DEFAULT_MODELS[provider];
}

function messagesFor(payload: Payload): ChatMessage[] {
  return (payload.messages || []).map((m) => ({ role: m.role, content: m.content }));
}

async function upstreamFor(
  provider: keyof typeof DEFAULT_MODELS,
  model: string,
  key: string,
  payload: Payload,
): Promise<Response> {
  const messages = messagesFor(payload);
  const system = (payload.systemInstruction || "").slice(0, 12000);

  if (provider === "gemini") {
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`,
    );
    url.searchParams.set("alt", "sse");
    url.searchParams.set("key", key);
    const body: Record<string, unknown> = {
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (payload.useSearchGrounding) body.tools = [{ googleSearch: {} }];
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  if (provider === "claude") {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        ...(system ? { system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  }

  const endpoint =
    provider === "gpt"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.x.ai/v1/chat/completions";
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
    }),
  });
}

function extractText(provider: keyof typeof DEFAULT_MODELS, data: any): string {
  if (provider === "claude") {
    return data?.type === "content_block_delta" && data?.delta?.type === "text_delta"
      ? String(data.delta.text || "")
      : "";
  }
  if (provider === "gemini") {
    return (data?.candidates?.[0]?.content?.parts || [])
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return String(data?.choices?.[0]?.delta?.content || "");
}

function streamResponse(
  upstream: Response,
  provider: keyof typeof DEFAULT_MODELS,
  model: string,
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sseFrame({
          type: "meta",
          runtime: "vercel-edge",
          backendModel: model,
          notice: `Connected to ${provider}. API credentials are held server-side.`,
        }),
      );
      if (!upstream.body) {
        controller.enqueue(sseFrame({ type: "error", message: "The AI provider returned an empty stream." }));
        controller.close();
        return;
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const text = extractText(provider, parsed);
              if (text) controller.enqueue(sseFrame({ type: "delta", text }));
              if (provider === "gemini") {
                const grounding = parsed?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                const sources = grounding
                  .map((item: any) =>
                    item?.web?.uri
                      ? { title: item.web.title || item.web.uri, url: item.web.uri }
                      : null,
                  )
                  .filter(Boolean);
                if (sources.length) controller.enqueue(sseFrame({ type: "sources", sources }));
              }
            } catch {
              /* ignore partial JSON */
            }
          }
        }
        controller.enqueue(sseFrame({ type: "done" }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The provider stream failed.";
        controller.enqueue(sseFrame({ type: "error", message }));
      } finally {
        try {
          upstream.body?.cancel();
        } catch {
          /* already closed */
        }
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleHealth(): Promise<Response> {
  return json({ status: "ok", runtime: "vercel-edge", timestamp: Date.now() });
}

export async function handleModelsStatus(): Promise<Response> {
  const gemini = Boolean(keyFor("gemini"));
  return json({
    unifiedAvailable: gemini,
    unifiedModel: modelFor("gemini"),
    providers: {
      gemini,
      openai: Boolean(keyFor("gpt")),
      xai: Boolean(keyFor("grok")),
      claude: Boolean(keyFor("claude")),
    },
    ollama: { connected: false, url: "browser-local", models: [] },
  });
}

export async function handleChat(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 160_000) return json({ error: "Request is too large." }, 413);

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ error: "Invalid JSON request body." }, 400);
  }

  const modelId = typeof payload.modelId === "string" ? payload.modelId : "";
  const allowed = ["forge", "gemini", "gpt", "grok", "claude"];
  if (!allowed.includes(modelId) && !modelId.startsWith("ollama:")) {
    return json({ error: "Unsupported model selection." }, 400);
  }
  if (modelId.startsWith("ollama:")) {
    return json(
      {
        error:
          "Ollama runs directly on your device. Select a cloud model or connect your local Ollama instance.",
      },
      400,
    );
  }

  const rawMessages: unknown = payload.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > 40) {
    return json({ error: "Provide between 1 and 40 chat messages." }, 400);
  }
  const validMessages = rawMessages.every(
    (m: any) =>
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length <= 24000,
  );
  if (!validMessages) return json({ error: "One or more messages are invalid or too long." }, 400);
  const messages = rawMessages as ChatMessage[];
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > 100000) return json({ error: "Message content exceeds the allowed limits." }, 413);
  payload.messages = messages;
  payload.systemInstruction =
    typeof payload.systemInstruction === "string" ? payload.systemInstruction.slice(0, 12000) : "";

  const requested = providerFor(modelId);
  let provider: keyof typeof DEFAULT_MODELS = requested;
  let key = keyFor(provider);
  if (!key) {
    if (provider !== "gemini" && keyFor("gemini")) {
      provider = "gemini";
      key = keyFor("gemini");
    } else {
      return json(
        {
          error: `No server-side API key is configured for ${provider}. Add it in Vercel project environment variables.`,
        },
        503,
      );
    }
  }

  let model = modelFor(provider);
  let upstream: Response;
  try {
    upstream = await upstreamFor(provider, model, key!, payload);
  } catch {
    return json(
      { error: `Could not connect to ${provider}. Check the API key and provider availability.` },
      502,
    );
  }

  if (!upstream.ok && provider !== "gemini" && keyFor("gemini")) {
    await upstream.body?.cancel();
    provider = "gemini";
    key = keyFor("gemini");
    model = modelFor(provider);
    try {
      upstream = await upstreamFor(provider, model, key!, payload);
    } catch {
      return json({ error: "Primary provider and Gemini fallback are unavailable." }, 502);
    }
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    const detail = (await upstream.text().catch(() => "")).slice(0, 600);
    return json(
      {
        error: `${provider} API returned ${status}. ${detail || "Check the provider key, model name, quota and account access."}`,
      },
      status === 429 ? 429 : 502,
    );
  }
  return streamResponse(upstream, provider, model);
}

export async function handleMega(request: Request): Promise<Response> {
  const base = env("MEGA_SERVICE_URL");
  const token = env("MEGA_SERVICE_TOKEN");
  if (!base || !token) {
    return json(
      {
        error:
          "MEGA service is not configured. Deploy the private MEGA service and set MEGA_SERVICE_URL and MEGA_SERVICE_TOKEN.",
      },
      503,
    );
  }
  const incoming = new URL(request.url);
  const target = new URL(
    incoming.pathname.replace(/^\/api\/storage\/mega/, "") + incoming.search,
    base.endsWith("/") ? base : `${base}/`,
  );
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  if (contentType) headers.set("content-type", contentType);
  if (authorization) headers.set("authorization", authorization);
  headers.set("x-service-token", token);
  headers.set("cache-control", "no-store");
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  try {
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("x-content-type-options", "nosniff");
    responseHeaders.delete("set-cookie");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return json(
      { error: "Could not reach the private MEGA service. Check its deployment URL and availability." },
      502,
    );
  }
}

export async function handleLive(): Promise<Response> {
  return json(
    {
      error:
        "This build uses offline browser speech mode; the Node WebSocket voice bridge is not enabled.",
    },
    501,
  );
}
