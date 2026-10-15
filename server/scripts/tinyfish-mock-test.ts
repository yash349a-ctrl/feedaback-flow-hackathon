import { fetchWebsiteContext, searchFeedbackSources } from "../src/services/tinyfish";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const previousKey = process.env.TINYFISH_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.TINYFISH_API_KEY = "mock-tinyfish-key";
  const calls: Array<{ url: string; method: string; key: string; body?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, key: headers.get("X-API-Key") || "", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("https://api.search.tinyfish.ai/")) {
      return new Response(JSON.stringify({ results: [{ position: 1, site_name: "Review Example", title: "Customer reviews", snippet: "Feedback from users", url: "reviews.example.com/product" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.fetch.tinyfish.ai") {
      return new Response(JSON.stringify({ results: [{ status: "success", title: "Customer reviews", final_url: "https://reviews.example.com/product", text: "Customer review: the interface is clear, but setup takes too long." }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected TinyFish endpoint ${url}`);
  }) as typeof fetch;

  try {
    const search = await searchFeedbackSources("Acme customer reviews");
    assert(search.length === 1, "Search should return one source");
    assert(search[0].url === "https://reviews.example.com/product", "Search should normalize a bare URL to HTTPS");
    const fetched = await fetchWebsiteContext(search[0].url);
    assert(fetched.text.includes("interface is clear"), "Fetch should return extracted page text");
    assert(calls.length === 2, "Search and Fetch should each make one request");
    assert(calls.every((call) => call.key === "mock-tinyfish-key"), "Both requests must include the server-side X-API-Key header");
    assert(calls[0].method === "GET" && calls[1].method === "POST", "Search must use GET and Fetch must use POST");
    const fetchBody = JSON.parse(calls[1].body || "{}");
    assert(fetchBody.urls?.[0] === search[0].url, "Fetch must receive the selected Search result URL");
    console.log("PASS: TinyFish Search request + source URL normalization");
    console.log("PASS: TinyFish Fetch request + server-side API-key header");
    console.log("PASS: Search result URL flows into Fetch and page text is parsed");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previousKey;
  }
}

main().catch((error) => { console.error("TinyFish mock integration test failed:", error); process.exitCode = 1; });
