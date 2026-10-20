import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const publicDir = resolve(process.argv[2] ?? "public");
const html = await readFile(join(publicDir, "index.html"), "utf8");
const manifest = JSON.parse(await readFile(join(publicDir, "deployment-manifest.json"), "utf8"));
const record = JSON.parse(await readFile(join(publicDir, "api/current-record.json"), "utf8"));
const code = String(manifest.code ?? "");
if (!html.trim()) throw new Error("homepage_empty");
if (!/^VIP10$|^GROWTH10$/.test(code)) throw new Error("unknown_site_code");
for (const value of [code, "Verified at checkout", "Dated record", "Cart-only"]) {
  if (!html.includes(value)) throw new Error(`homepage_missing_required_copy:${value}`);
}
const localRefs = [...html.matchAll(/(?:href|src)="(\/(?!\/)[^"?#]+)"/g)].map(([, ref]) => ref);
const styles = localRefs.filter((ref) => /\.css(?:$|\?)/i.test(ref));
if (!styles.length) throw new Error("homepage_stylesheet_missing");
for (const ref of [...new Set(styles)]) await access(join(publicDir, ref.split("?")[0].replace(/^\//, "")));
const designMarkers = code === "VIP10"
  ? ["hero-cinematic", "verification-artifact", "wordmark"]
  : ["/assets/", "hero", "verification"];
for (const marker of designMarkers) if (!html.includes(marker)) throw new Error(`homepage_design_marker_missing:${marker}`);
const imageRefs = localRefs.filter((ref) => /\.(?:png|jpe?g|webp|svg)(?:$|\?)/i.test(ref));
if (!imageRefs.length) throw new Error("homepage_graphic_missing");
for (const ref of [...new Set(imageRefs)]) await access(join(publicDir, ref.split("?")[0].replace(/^\//, "")));
for (const [key, value] of [["product", record.product], ["observed_at", record.observed_at]]) {
  if (!html.includes(String(value))) throw new Error(`homepage_current_record_missing:${key}`);
}
console.log(JSON.stringify({ code, styles: [...new Set(styles)].length, graphics: [...new Set(imageRefs)].length, status: "presentation_guard_passed" }));
