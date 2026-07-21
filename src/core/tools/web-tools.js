const axios = require("axios");
const cheerio = require("cheerio");

const defaultHttpsAgent = new (require("https").Agent)(); // secure by default!

function decodeDuckDuckGoUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const encoded = url.searchParams.get("uddg");
    if (encoded) {
      return decodeURIComponent(encoded);
    }
    return url.toString();
  } catch (error) {
    return rawUrl;
  }
}

function normalizeSearchQuery(question) {
  let q = String(question || "").trim();
  q = q.replace(
    /^\s*(look\s*up|lookup|search\s*(?:the\s*)?web\s*(?:for)?|search\s*online\s*(?:for)?|google\s*(?:for)?|find\s*online\s*(?:for)?)\s*/i,
    ""
  );
  return q.trim();
}

async function duckDuckGoSearch(query, limit = 5, httpsAgent) {
  const response = await axios.get("https://duckduckgo.com/html/", {
    params: { q: query },
    headers: {
      "User-Agent": "Mozilla/5.0 (Pennyworth)",
    },
    timeout: 9000,
    httpsAgent: httpsAgent || defaultHttpsAgent,
  });

  const $ = cheerio.load(response.data || "");
  const rows = [];

  $(".result").each((_, node) => {
    if (rows.length >= limit) {
      return;
    }

    const titleAnchor = $(node).find("a.result__a").first();
    const snippetNode = $(node).find(".result__snippet").first();
    const title = titleAnchor.text().trim();
    const href = titleAnchor.attr("href") || "";
    const url = decodeDuckDuckGoUrl(href);
    const snippet = snippetNode.text().trim();

    if (title && url) {
      rows.push({ title, url, snippet });
    }
  });

  return rows;
}

function buildWebReply(query, results) {
  if (!results.length) {
    return `I ran a web lookup for '${query}' but found no reliable results.`;
  }

  const lines = [`Web results for '${query}':`];
  results.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.title}`);
    lines.push(`   ${row.url}`);
    if (row.snippet) {
      lines.push(`   ${row.snippet}`);
    }
  });
  lines.push("Source: DuckDuckGo web search");
  return lines.join("\n");
}

function isWebSearchIntent(question) {
  const text = String(question || "");
  if (
    /\b(lookup|look\s+up|search\s+(?:the\s+)?web|web\s+search|search\s+online|find\s+online|latest\s+news|what\s+is\s+happening\s+with|google)\b/i.test(
      text
    )
  ) {
    return true;
  }

  if (/\b(latest|news|today)\b/i.test(text) && /\b(on|about|regarding)\b/i.test(text)) {
    return true;
  }

  return false;
}

async function runWebSearchTool(question, queryOverride, httpsAgent) {
  const query = String(queryOverride || normalizeSearchQuery(question)).trim();
  if (!query) {
    return {
      handled: true,
      tool: "web_search",
      reply: "Tell me what to search for. Example: 'search the web for latest CachyOS updates'.",
    };
  }

  const results = await duckDuckGoSearch(query, 5, httpsAgent);
  return {
    handled: true,
    tool: "web_search",
    reply: buildWebReply(query, results),
    data: { query, results },
  };
}

module.exports = {
  isWebSearchIntent,
  runWebSearchTool,
};
