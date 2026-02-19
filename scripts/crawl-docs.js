const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const root = path.resolve(__dirname, "..");
const distroConfigRaw = fs.readFileSync(path.join(root, "config", "distros.json"), "utf8");
const distroConfig = JSON.parse(distroConfigRaw.replace(/^\uFEFF/, ""));

const profileId = process.argv[2] || distroConfig.defaultProfile;
const maxPages = Number(process.argv[3] || 30);

const profile = distroConfig.profiles[profileId];
if (!profile) {
  throw new Error(`Unknown profile: ${profileId}`);
}

const outDir = path.join(root, "data", "docs", profileId);
fs.mkdirSync(outDir, { recursive: true });

function sanitizeName(url) {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function extractText($) {
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function isAllowed(url) {
  try {
    const host = new URL(url).hostname;
    return profile.documentation.allowedDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

async function crawl() {
  const queue = [profile.documentation.rootUrl];
  const seen = new Set();

  while (queue.length && seen.size < maxPages) {
    const url = queue.shift();
    if (seen.has(url) || !isAllowed(url)) {
      continue;
    }

    seen.add(url);

    try {
      const response = await axios.get(url, { timeout: 20000 });
      const html = response.data;
      const $ = cheerio.load(html);
      const text = extractText($);

      const fileName = `${sanitizeName(url)}.md`;
      const payload = `# Source\n${url}\n\n# Extracted Text\n\n${text}\n`;
      fs.writeFileSync(path.join(outDir, fileName), payload, "utf8");
      console.log(`Saved ${fileName}`);

      $("a[href]").each((_, link) => {
        const href = $(link).attr("href");
        if (!href) {
          return;
        }

        try {
          const next = new URL(href, url).toString();
          if (!seen.has(next) && isAllowed(next)) {
            queue.push(next);
          }
        } catch {
          // Ignore malformed URLs.
        }
      });
    } catch (error) {
      console.warn(`Skipped ${url} (${error.message})`);
    }
  }

  console.log(`Done. Crawled ${seen.size} page(s) for profile '${profileId}'.`);
}

crawl();
