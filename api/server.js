// Replace the current Cloudflare Worker code with this file.
// Main fixes: retry transient upstream failures, retry an empty Songs result,
// fall back to general Music search, and remove one YouTube request per result.

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Do not let browsers or intermediary caches preserve an empty search result.
  "Cache-Control": "no-store"
};
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20231214.00.00", hl: "id", gl: "ID" };
const SONGS_FILTER = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": UA,
  "Origin": "https://music.youtube.com",
  "Referer": "https://music.youtube.com/"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return jsonResponse({ error: "Gunakan metode GET." }, 405);

  const query = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!query) return jsonResponse({ error: "Parameter 'q' wajib diisi." }, 400);

  try {
    // YouTube Music occasionally answers 200 with an empty filtered result.
    let results = await searchWithRetry(query, SONGS_FILTER);
    if (results.length === 0) {
      await delay(350);
      results = await searchWithRetry(query, SONGS_FILTER);
    }
    // Keep the song filter as the normal path, but do not return a false empty
    // result when YouTube's filtered endpoint is temporarily inconsistent.
    if (results.length === 0) results = await searchWithRetry(query, null);
    return jsonResponse(results.slice(0, 20));
  } catch (error) {
    return jsonResponse({ error: "YouTube Music sedang gagal merespons.", detail: String(error?.message || error) }, 502);
  }
}

async function searchWithRetry(query, params) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const payload = { context: { client: CLIENT }, query };
      if (params) payload.params = params;
      const response = await fetch("https://music.youtube.com/youtubei/v1/search?alt=json", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`YouTube Music HTTP ${response.status}`);
        if (response.status === 429 || response.status >= 500) throw error;
        throw error;
      }
      const data = await response.json();
      return extractTracks(data);
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await delay(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Permintaan pencarian gagal.");
}

function extractTracks(data) {
  const results = [];
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    const item = value.musicResponsiveListItemRenderer;
    if (item) {
      const id = item.playlistItemData?.videoId
        || item.doubleTapCommand?.watchEndpoint?.videoId
        || item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      const columns = item.flexColumns || [];
      const titleRuns = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const metadataRuns = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const title = titleRuns.map(run => run.text || "").join("").trim();
      const meaningfulRuns = metadataRuns.filter(run => run.text && !/^[\s·•|]+$/.test(run.text));
      const artistRun = meaningfulRuns.find(run => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC"));
      const albumRun = meaningfulRuns.find(run => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("MPRE"));
      const artist = artistRun?.text || meaningfulRuns[0]?.text || "Artis tidak diketahui";
      const album = albumRun?.text || artist;
      const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || item.thumbnail?.thumbnails || [];
      let coverArt = thumbnails.length ? thumbnails[thumbnails.length - 1].url || "" : "";
      if (coverArt.includes("googleusercontent.com")) {
        coverArt = `${coverArt.split("=")[0]}=w544-h544-l90-rj-l90-rj`;
      }
      if (id && !seen.has(id)) {
        seen.add(id);
        results.push({ id, judul: title || "Lagu tanpa judul", artis: artist, album, coverArt });
      }
    }
    for (const child of Object.values(value)) visit(child);
  }

  visit(data);
  return results;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
