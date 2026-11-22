// Replace the current Cloudflare Worker code with this file.
// Supports: songs (default), artists (1:1 profile photo & subscriber count),
// community playlists (thumbnail & track count), or all combined.

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20231214.00.00", hl: "id", gl: "ID" };

// Filter Protobuf params untuk YouTube Music InnerTube API
const FILTERS = {
  song: "EgWKAQIIAWoKEAkQBRAKEAMQBA==",
  artist: "EgWKAQIgAWoKEAkQBRAKEAMQBA==",
  playlist: "EgeKAQQoAEABagoQAxAEEAoQBRAJ" // Community playlists
};

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

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  const type = (url.searchParams.get("type") || "song").toLowerCase().trim();

  if (!query) return jsonResponse({ error: "Parameter 'q' wajib diisi." }, 400);

  try {
    // Mode gabungan: cari lagu, artis, dan playlist komunitas secara paralel
    if (type === "all") {
      const [songs, artists, playlists] = await Promise.all([
        searchCategory(query, "song"),
        searchCategory(query, "artist"),
        searchCategory(query, "playlist")
      ]);
      return jsonResponse({
        songs: songs.slice(0, 15),
        artists: artists.slice(0, 10),
        playlists: playlists.slice(0, 15)
      });
    }

    // Mode spesifik: song (default), artist, atau playlist
    if (!FILTERS[type]) {
      return jsonResponse({ error: "Parameter 'type' tidak valid. Gunakan: song, artist, playlist, atau all." }, 400);
    }

    const results = await searchCategory(query, type);
    return jsonResponse(results.slice(0, 20));
  } catch (error) {
    return jsonResponse({
      error: "YouTube Music sedang gagal merespons.",
      detail: String(error?.message || error)
    }, 502);
  }
}

async function searchCategory(query, type) {
  const filterParam = FILTERS[type];
  let results = await searchWithRetry(query, filterParam, type);

  if (results.length === 0) {
    await delay(350);
    results = await searchWithRetry(query, filterParam, type);
  }

  // Fallback ke pencarian umum tanpa filter jika endpoint terfilter kosong sementara
  if (results.length === 0) {
    results = await searchWithRetry(query, null, type);
  }

  return results;
}

async function searchWithRetry(query, params, type) {
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
      if (type === "artist") return extractArtists(data);
      if (type === "playlist") return extractPlaylists(data);
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

// Helper untuk memperbesar resolusi gambar & memaksa rasio 1:1 jika squareCrop = true
function upgradeThumbnail(item, squareCrop = false) {
  const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
    || item.thumbnail?.thumbnails || [];

  const exactSquare = thumbnails.find(t => t.width && t.height && t.width === t.height);
  const chosen = exactSquare || thumbnails[thumbnails.length - 1] || {};
  let url = chosen.url || "";

  if (!url) return "";

  if (url.includes("googleusercontent.com") || url.includes("ggpht.com")) {
    const baseUrl = url.split("=")[0];
    return squareCrop
      ? `${baseUrl}=s544-c-k-c0x00ffffff-no-rj`
      : `${baseUrl}=w544-h544-l90-rj`;
  }

  return url;
}

// Helper mengambil teks bersih per kolom
function getColumnRuns(item, index) {
  const columns = item.flexColumns || [];
  const runs = columns[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  return runs.filter(run => run.text && !/^[\s·•|]+$/.test(run.text));
}

// 1. Ekstrak Lagu
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

      const titleRuns = getColumnRuns(item, 0);
      const meaningfulRuns = getColumnRuns(item, 1);

      const title = titleRuns.map(r => r.text).join("").trim();
      const artistRun = meaningfulRuns.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC"));
      const albumRun = meaningfulRuns.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("MPRE"));
      const artist = artistRun?.text || meaningfulRuns[0]?.text || "Artis tidak diketahui";
      const album = albumRun?.text || artist;
      const coverArt = upgradeThumbnail(item, false);

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

// 2. Ekstrak Artis (Nama, Foto Profil 1:1, Jumlah Subscriber)
function extractArtists(data) {
  const results = [];
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    const item = value.musicResponsiveListItemRenderer;
    if (item) {
      const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
      const browseId = browseEndpoint?.browseId || "";
      const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";

      if (browseId.startsWith("UC") && (!pageType || pageType === "MUSIC_PAGE_TYPE_ARTIST")) {
        const titleRuns = getColumnRuns(item, 0);
        const subRuns = getColumnRuns(item, 1);

        const nama = titleRuns.map(r => r.text).join("").trim();
        const subText = subRuns.find(r => /subscriber|pelanggan/i.test(r.text))?.text
          || subRuns.find(r => r.text.toLowerCase() !== "artis" && r.text.toLowerCase() !== "artist")?.text
          || "Tidak diketahui";
        const fotoProfil = upgradeThumbnail(item, true);

        if (nama && !seen.has(browseId)) {
          seen.add(browseId);
          results.push({
            id: browseId,
            nama,
            fotoProfil,
            subscriber: subText.trim()
          });
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }

  visit(data);
  return results;
}

// 3. Ekstrak Playlist Komunitas (Judul, Pembuat, Thumbnail, Jumlah Lagu)
function extractPlaylists(data) {
  const results = [];
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    const item = value.musicResponsiveListItemRenderer;
    if (item) {
      const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
      const browseId = browseEndpoint?.browseId || "";
      const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";

      const isPlaylist = pageType === "MUSIC_PAGE_TYPE_PLAYLIST"
        || browseId.startsWith("VLPL")
        || browseId.startsWith("PL");

      if (isPlaylist && browseId) {
        const titleRuns = getColumnRuns(item, 0);
        const metaRuns = getColumnRuns(item, 1);

        const judul = titleRuns.map(r => r.text).join("").trim();
        const countRun = metaRuns.find(r => /\d+\s*(lagu|song|track)/i.test(r.text));
        const creatorRun = metaRuns.find(r =>
          r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC")
          || (!/playlist/i.test(r.text) && r !== countRun)
        );

        const thumbnail = upgradeThumbnail(item, false);
        const jumlahLagu = countRun ? countRun.text.trim() : "Tidak diketahui";
        const pembuat = creatorRun ? creatorRun.text.trim() : "Pengguna YouTube Music";

        if (judul && !seen.has(browseId)) {
          seen.add(browseId);
          results.push({
            id: browseId,
            judul,
            pembuat,
            thumbnail,
            jumlahLagu
          });
        }
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
