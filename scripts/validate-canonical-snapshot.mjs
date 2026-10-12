import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const publicDir = resolve(process.argv[2] ?? "public");
const routeMap = JSON.parse(await readFile(join(publicDir, "static-route-map.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(publicDir, "deployment-manifest.json"), "utf8"));
const sitemap = await readFile(join(publicDir, "sitemap.xml"), "utf8");
await access(join(publicDir, ".nojekyll"));

if (manifest.deploymentState !== "built_not_deployed") throw new Error("unexpected_deployment_state");
if (manifest.source !== "canonical_public_html_snapshot") throw new Error("snapshot_source_missing");
if (!manifest.canonicalSnapshot?.publicRouteCount) throw new Error("snapshot_metadata_missing");
if (!Number.isInteger(manifest.canonicalSnapshot?.publicHostedAssetCount)) throw new Error("hosted_asset_metadata_missing");
if (Object.keys(routeMap).length < manifest.canonicalSnapshot.publicRouteCount) throw new Error("route_map_incomplete");
if ((sitemap.match(/<loc>/g) ?? []).length !== manifest.canonicalSnapshot.publicRouteCount) throw new Error("sitemap_count_mismatch");
for (const output of Object.values(routeMap)) {
  await access(join(publicDir, output.replace(/^\//, "")));
}
console.log(JSON.stringify({
  publicRouteCount: manifest.canonicalSnapshot.publicRouteCount,
  mappedRouteCount: Object.keys(routeMap).length,
  nextAssetCount: manifest.canonicalSnapshot.nextAssetCount,
  deploymentState: manifest.deploymentState,
}));
