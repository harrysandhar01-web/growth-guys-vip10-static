import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const canonicalOrigin = (process.env.CANONICAL_ORIGIN ?? "https://growthguysvip10.ca").replace(/\/$/, "");
const publicDir = resolve(process.argv[2] ?? "public");
const generatedAt = new Date().toISOString();
const concurrency = 6;

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((value) => value.startsWith(canonicalOrigin));
}

function safePathname(url) {
  const value = new URL(url);
  if (value.origin !== canonicalOrigin) throw new Error(`unexpected_origin:${value.origin}`);
  const pathname = decodeURIComponent(value.pathname);
  if (!pathname.startsWith("/") || pathname.split("/").includes("..")) {
    throw new Error(`unsafe_path:${pathname}`);
  }
  return pathname;
}

function htmlFile(pathname) {
  return pathname === "/" ? "index.html" : `${pathname.replace(/^\/+|\/+$/g, "")}/index.html`;
}

function assetFile(pathname) {
  return pathname.replace(/^\/+/, "");
}

async function fetchRequired(url, responseType = "text") {
  const response = await fetch(url, {
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "GrowthGuysVIP10PrivateSnapshot/1.0",
    },
  });
  if (!response.ok) throw new Error(`fetch_failed:${response.status}:${url}`);
  return responseType === "bytes" ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

async function put(relativePath, body) {
  const destination = join(publicDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
}

async function mapLimit(items, mapper) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
}

function collectNextAssets(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const raw = match[1];
    if (!raw.startsWith("/_next/")) continue;
    const url = new URL(raw, canonicalOrigin);
    if (url.search) continue;
    assets.add(url.pathname);
  }
  return assets;
}

const sitemap = await fetchRequired(`${canonicalOrigin}/sitemap.xml`);
const pageUrls = sitemapUrls(sitemap);
if (pageUrls.length === 0) throw new Error("empty_canonical_sitemap");

await rm(join(publicDir, "snapshot-pages"), { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await mkdir("source-inventory", { recursive: true });
await writeFile("source-inventory/live-sitemap-2026-10-12.xml", sitemap);

const routeMap = {};
const assets = new Set();
await mapLimit(pageUrls, async (url, index) => {
  const html = await fetchRequired(url);
  const pathname = safePathname(url);
  const output = htmlFile(pathname);
  await put(output, html);
  routeMap[pathname === "/" ? "/" : `${pathname.replace(/\/+$/, "")}/`] = `/${output}`;
  for (const asset of collectNextAssets(html)) assets.add(asset);
  if ((index + 1) % 25 === 0 || index + 1 === pageUrls.length) {
    console.log(`pages=${index + 1}/${pageUrls.length}`);
  }
});

await mapLimit([...assets].sort(), async (pathname, index) => {
  const bytes = await fetchRequired(`${canonicalOrigin}${pathname}`, "bytes");
  await put(assetFile(pathname), bytes);
  if ((index + 1) % 25 === 0 || index + 1 === assets.size) {
    console.log(`assets=${index + 1}/${assets.size}`);
  }
});

const dataRoutes = {
  "/api/current-record": "/api/current-record.json",
  "/verification-feed.json": "/verification-feed.json",
  "/feed.xml": "/feed.xml",
  "/robots.txt": "/robots.txt",
  "/sitemap.xml": "/sitemap.xml",
};
for (const [route, output] of Object.entries(dataRoutes)) {
  const responseType = output.endsWith(".json") || output.endsWith(".xml") || output.endsWith(".txt") ? "text" : "bytes";
  await put(output.slice(1), await fetchRequired(`${canonicalOrigin}${route}`, responseType));
  routeMap[route] = output;
}

const currentRecord = JSON.parse(await readFile(join(publicDir, "api/current-record.json"), "utf8"));
const manifestPath = join(publicDir, "deployment-manifest.json");
const prior = JSON.parse(await readFile(manifestPath, "utf8"));
const manifest = {
  ...prior,
  generatedAt,
  canonicalOrigin,
  source: "canonical_public_html_snapshot",
  deploymentState: "built_not_deployed",
  staticRoutes: Object.fromEntries(Object.entries(routeMap).sort(([a], [b]) => a.localeCompare(b))),
  canonicalSnapshot: {
    generatedAt,
    publicRouteCount: pageUrls.length,
    nextAssetCount: assets.size,
    currentRecordEventKey: currentRecord?.record?.eventKey ?? null,
    currentRecordObservedAt: currentRecord?.record?.observedAt ?? null,
    sourceOrigin: canonicalOrigin,
  },
};
await put("static-route-map.json", `${JSON.stringify(manifest.staticRoutes, null, 2)}\n`);
await put("deployment-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ publicRouteCount: pageUrls.length, nextAssetCount: assets.size, deploymentState: manifest.deploymentState }));
