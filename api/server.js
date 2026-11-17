addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
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

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();
  const streamId = (url.searchParams.get("stream") || "").trim();
  const query = (url.searchParams.get("q") || "").trim();

  // 1. JIKA AKSES ?id=VIDEO_ID -> TAMPILKAN HALAMAN PEMUTAR AUDIO BAWAAN WEB
  if (id) {
    return renderAudioPage(id, url.origin);
  }

  // 2. JIKA AKSES ?stream=VIDEO_ID -> ALIRKAN FILE AUDIO UNTUK TAG <audio>
  if (streamId) {
    return handleAudioStream(streamId, request);
  }

  // 3. JIKA AKSES ?q=KEYWORD -> KEMBALIKAN JSON PENCARIAN (FITUR LAMA)
  if (!query) {
    return jsonResponse({ error: "Gunakan parameter ?q=judul, ?id=video_id, atau ?stream=video_id" }, 400);
  }

  try {
    let results = await searchWithRetry(query, SONGS_FILTER);
    if (results.length === 0) {
      await delay(350);
      results = await searchWithRetry(query, SONGS_FILTER);
    }
    if (results.length === 0) results = await searchWithRetry(query, null);
    return jsonResponse(results.slice(0, 20));
  } catch (error) {
    return jsonResponse({ error: "YouTube Music sedang gagal merespons.", detail: String(error?.message || error) }, 502);
  }
}

// Fungsi merender halaman HTML dengan pemutar <audio> bawaan browser
function renderAudioPage(videoId, origin) {
  // Sanitasi sederhana mencegah XSS
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  const streamUrl = `${origin}/?stream=${safeId}`;

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audio Player - ${safeId}</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background-color: #121212;
    }
    audio {
      width: 90%;
      max-width: 400px;
    }
  </style>
</head>
<body>
  <audio controls autoplay src="${streamUrl}">
    Browser kamu tidak mendukung elemen audio.
  </audio>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...CORS
    }
  });
}

// Fungsi mengambil & mem-proxy audio stream dari YouTube
async function handleAudioStream(videoId, request) {
  try {
    const playerPayload = {
      context: {
        client: {
          clientName: "ANDROID_MUSIC",
          clientVersion: "6.42.52",
          androidSdkVersion: 30,
          hl: "id",
          gl: "ID"
        }
      },
      videoId: videoId
    };

    const playerRes = await fetch("https://music.youtube.com/youtubei/v1/player?alt=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 11) gzip"
      },
      body: JSON.stringify(playerPayload)
    });

    if (!playerRes.ok) {
      return jsonResponse({ error: `Gagal mengambil data player (${playerRes.status})` }, 502);
    }

    const playerData = await playerRes.json();
    const formats = playerData?.streamingData?.adaptiveFormats || [];

    const audioFormats = formats
      .filter(f => f.mimeType && f.mimeType.startsWith("audio/") && f.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (audioFormats.length === 0) {
      return jsonResponse({ error: "Stream audio tidak tersedia untuk ID ini." }, 404);
    }

    const bestAudio = audioFormats[0];

    const fetchHeaders = {
      "User-Agent": "com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 11) gzip"
    };
    const rangeHeader = request.headers.get("Range");
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    const audioRes = await fetch(bestAudio.url, { headers: fetchHeaders });

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", bestAudio.mimeType.split(";")[0]);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Accept-Ranges", "bytes");

    if (audioRes.headers.has("Content-Length")) {
      responseHeaders.set("Content-Length", audioRes.headers.get("Content-Length"));
    }
    if (audioRes.headers.has("Content-Range")) {
      responseHeaders.set("Content-Range", audioRes.headers.get("Content-Range"));
    }

    return new Response(audioRes.body, {
      status: audioRes.status,
      headers: responseHeaders
    });

  } catch (error) {
    return jsonResponse({ error: "Gagal memproses stream audio.", detail: String(error?.message || error) }, 500);
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
