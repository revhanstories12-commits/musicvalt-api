// Replace the current Cloudflare Worker code with this file.
// Supports:
// - ?q=...&type=song (default)
// - ?q=...&type=artist
// - ?q=...&type=playlist (with track count + browse fallback)
// - ?q=...&type=all
// - ?playlistId=VLPL... (fetch playlist metadata + tracks)

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

const FILTERS = {
  song: "EgWKAQIIAWoKEAkQBRAKEAMQBA==",
  artist: "EgWKAQIgAWoKEAkQBRAKEAMQBA==",
  playlist: "EgeKAQQoAEABagoQAxAEEAoQBRAJ"
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
  const playlistId = (url.searchParams.get("playlistId") || "").trim();
  const query = (url.searchParams.get("q") || "").trim();
  const type = (url.searchParams.get("type") || "song").toLowerCase().trim();

  try {
    if (playlistId) {
      const detail = await fetchPlaylistDetail(playlistId);
      return jsonResponse(detail);
    }

    if (!query) return jsonResponse({ error: "Parameter 'q' wajib diisi." }, 400);

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

  if (results.length === 0) {
    results = await searchWithRetry(query, null, type);
  }

  if (type === "playlist" && results.length > 0) {
    results = await Promise.all(
      results.map(async pl => {
        if (pl.jumlahLagu !== "Tidak diketahui") return pl;
        const count = await fetchPlaylistTrackCount(pl.id);
        return count ? { ...pl, jumlahLagu: count } : pl;
      })
    );
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

function parseTrackCountFromTexts(texts = []) {
  for (const raw of texts) {
    const text = String(raw || "").trim();
    if (!text) continue;
    // Abaikan teks yang jelas-jelas views / ditonton / durasi
    if (/ditonton|views?|menit|jam|detik/i.test(text)) continue;

    const labeledMatch = text.match(/([\d.,]+\s*(?:lagu|song|songs|track|tracks|video|videos))/i);
    if (labeledMatch) return labeledMatch[1].trim();
  }
  return null;
}

async function fetchPlaylistTrackCount(browseId) {
  try {
    const normalizedId = browseId.startsWith("VL") ? browseId : `VL${browseId}`;
    const response = await fetch("https://music.youtube.com/youtubei/v1/browse?alt=json", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        context: { client: CLIENT },
        browseId: normalizedId
      })
    });
    if (!response.ok) return null;
    const data = await response.json();

    const header = data.header?.musicDetailHeaderRenderer
      || data.header?.musicResponsiveHeaderRenderer
      || findObjectByKey(data, "musicResponsiveHeaderRenderer")
      || findObjectByKey(data, "musicDetailHeaderRenderer");

    const candidateTexts = [
      ...(header?.secondSubtitle?.runs || []).map(r => r.text),
      ...(header?.subtitle?.runs || []).map(r => r.text),
      ...(header?.straplineTextOne?.runs || []).map(r => r.text)
    ];

    const fromHeader = parseTrackCountFromTexts(candidateTexts);
    if (fromHeader) return fromHeader;

    const shelf = findObjectByKey(data, "musicShelfRenderer");
    const shelfTexts = (shelf?.subtitle?.runs || []).map(r => r.text);
    const fromShelf = parseTrackCountFromTexts(shelfTexts);
    if (fromShelf) return fromShelf;

    const tracks = extractTracks(data);
    if (tracks.length > 0) return `${tracks.length} lagu`;
    return null;
  } catch {
    return null;
  }
}

async function fetchPlaylistDetail(browseId) {
  const normalizedId = browseId.startsWith("VL") ? browseId : `VL${browseId}`;
  const response = await fetch("https://music.youtube.com/youtubei/v1/browse?alt=json", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      context: { client: CLIENT },
      browseId: normalizedId
    })
  });
  if (!response.ok) {
    throw new Error(`YouTube Music HTTP ${response.status}`);
  }
  const data = await response.json();

  const header = data.header?.musicDetailHeaderRenderer
    || data.header?.musicResponsiveHeaderRenderer
    || findObjectByKey(data, "musicResponsiveHeaderRenderer")
    || findObjectByKey(data, "musicDetailHeaderRenderer");

  const judul = (header?.title?.runs || []).map(r => r.text).join("").trim() || "Playlist";
  const candidateTexts = [
    ...(header?.secondSubtitle?.runs || []).map(r => r.text),
    ...(header?.subtitle?.runs || []).map(r => r.text),
    ...(header?.straplineTextOne?.runs || []).map(r => r.text)
  ];

  const tracks = extractTracks(data);
  const jumlahLagu = parseTrackCountFromTexts(candidateTexts) || `${tracks.length} lagu`;

  return {
    id: normalizedId,
    judul,
    jumlahLagu,
    tracks
  };
}

function findObjectByKey(obj, targetKey) {
  if (!obj || typeof obj !== "object") return null;
  if (obj[targetKey]) return obj[targetKey];
  for (const val of Object.values(obj)) {
    const found = findObjectByKey(val, targetKey);
    if (found) return found;
  }
  return null;
}

function getHighResThumbnail(item, mode = "song") {
  const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
    || item.thumbnail?.thumbnails || [];

  const chosen = thumbnails[thumbnails.length - 1] || {};
  const url = chosen.url || "";

  if (!url) return "";

  if (url.includes("googleusercontent.com") || url.includes("ggpht.com")) {
    const baseUrl = url.split("=")[0];
    if (mode === "artist") {
      return `${baseUrl}=s800-no-rj`;
    }
    return `${baseUrl}=w800-h800-l90-rj`;
  }

  return url;
}

function getColumnRuns(item, index) {
  const columns = item.flexColumns || [];
  const runs = columns[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  return runs.filter(run => run.text && !/^[\s·•|]+$/.test(run.text));
}

function getAllRuns(item) {
  const columns = item.flexColumns || [];
  const all = [];
  for (const col of columns) {
    const runs = col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    for (const run of runs) {
      if (run.text && !/^[\s·•|]+$/.test(run.text)) {
        all.push(run);
      }
    }
  }
  return all;
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

      const titleRuns = getColumnRuns(item, 0);
      const meaningfulRuns = getColumnRuns(item, 1);

      const title = titleRuns.map(r => r.text).join("").trim();
      const artistRun = meaningfulRuns.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC"));
      const albumRun = meaningfulRuns.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("MPRE"));
      const artist = artistRun?.text || meaningfulRuns[0]?.text || "Artis tidak diketahui";
      const album = albumRun?.text || artist;
      const coverArt = getHighResThumbnail(item, "song");

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
        const subRuns = getAllRuns(item).slice(1);

        const nama = titleRuns.map(r => r.text).join("").trim();
        const subText = subRuns.find(r => /subscriber|pelanggan/i.test(r.text))?.text
          || subRuns.find(r => r.text.toLowerCase() !== "artis" && r.text.toLowerCase() !== "artist")?.text
          || "Tidak diketahui";
        const fotoProfil = getHighResThumbnail(item, "artist");

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
        const allMetaRuns = getAllRuns(item).slice(titleRuns.length);

        const judul = titleRuns.map(r => r.text).join("").trim();

        const countText = parseTrackCountFromTexts(allMetaRuns.map(r => r.text));
        const jumlahLagu = countText || "Tidak diketahui";
        const countRun = countText
          ? allMetaRuns.find(r => r.text.toLowerCase().includes(countText.toLowerCase()))
          : null;

        const creatorRun = allMetaRuns.find(r =>
          r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC")
          || (!/playlist/i.test(r.text) && !/ditonton|views/i.test(r.text) && r !== countRun)
        );

        const thumbnail = getHighResThumbnail(item, "playlist");
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
