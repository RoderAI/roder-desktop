#!/usr/bin/env node
/**
 * Write Sparkle-compatible update feeds into dist/ for R2 publish.
 *
 * Env:
 *   DIST_DIR (default: dist)
 *   R2_PUBLIC_BASE_URL (default: https://dl.roder.sh)
 *   CHANNEL_PREFIX (default: desktop/latest) — public URL prefix for enclosure links
 *   VERSION — semver without leading v (falls back to package.json)
 *   TAG — optional git tag (e.g. v0.1.2)
 *   RELEASE_NOTES — optional notes body
 *   PUB_DATE — optional ISO timestamp
 */
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(process.env.DIST_DIR || "dist");
const publicBase = (process.env.R2_PUBLIC_BASE_URL || "https://dl.roder.sh").replace(/\/$/, "");
const channelPrefix = (process.env.CHANNEL_PREFIX || "desktop/latest").replace(/^\/+|\/+$/g, "");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = (process.env.VERSION || packageJson.version || "").replace(/^v/i, "");
const tag = process.env.TAG || (version ? `v${version}` : "");
const pubDate = process.env.PUB_DATE || new Date().toISOString();
const notes = (process.env.RELEASE_NOTES || `Roder Desktop ${tag || version}`).trim();
const zipName = "Roder-macos-arm64.zip";
const zipPath = join(distDir, zipName);

if (!version) {
  console.error("generate-desktop-update-feeds: VERSION or package.json version is required");
  process.exit(1);
}

if (!existsSync(zipPath)) {
  console.log(`generate-desktop-update-feeds: ${zipName} missing in ${distDir}; skipping feeds`);
  process.exit(0);
}

const zipUrl = `${publicBase}/${channelPrefix}/${zipName}`;
const zipBytes = statSync(zipPath).size;
const appcastUrl = `${publicBase}/${channelPrefix}/appcast.xml`;
const releaseUrl = tag
  ? `https://github.com/RoderAI/roder-desktop/releases/tag/${tag}`
  : "https://github.com/RoderAI/roder-desktop/releases";

const updates = {
  url: zipUrl,
  name: version,
  notes,
  pub_date: pubDate,
};

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const notesHtml = escapeXml(notes.replaceAll("\n", "<br/>"));
const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Roder Desktop</title>
    <link>${escapeXml(appcastUrl)}</link>
    <description>Roder Desktop macOS updates</description>
    <language>en</language>
    <item>
      <title>${escapeXml(`Roder Desktop ${version}`)}</title>
      <link>${escapeXml(releaseUrl)}</link>
      <sparkle:version>${escapeXml(version)}</sparkle:version>
      <sparkle:shortVersionString>${escapeXml(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <description><![CDATA[<p>${notesHtml}</p>]]></description>
      <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
      <enclosure
        url="${escapeXml(zipUrl)}"
        type="application/octet-stream"
        length="${zipBytes}"
        sparkle:os="macos"
      />
    </item>
  </channel>
</rss>
`;

writeFileSync(join(distDir, "updates.json"), `${JSON.stringify(updates, null, 2)}\n`);
writeFileSync(join(distDir, "appcast.xml"), appcast);
console.log(`generate-desktop-update-feeds: wrote ${distDir}/updates.json`);
console.log(`generate-desktop-update-feeds: wrote ${distDir}/appcast.xml`);
console.log(`generate-desktop-update-feeds: enclosure ${zipUrl}`);
