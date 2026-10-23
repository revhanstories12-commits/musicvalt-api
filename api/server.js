export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const id = url.searchParams.get('id');

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    try {
      // 1. FITUR PENCARIAN LAGU RESMI YOUTUBE MUSIC
      if (q) {
        const ytRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20240101.01.00',
                hl: 'id',
                gl: 'ID'
              }
            },
            query: q
          })
        });

        const ytData = await ytRes.json();
        
        // Ambil section hasil pencarian
        const shelfContents = ytData?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

        const tracks = [];

        for (const section of shelfContents) {
          const items = section?.musicShelfRenderer?.contents || [];
          for (const item of items) {
            const flexColumns = item?.musicResponsiveListItemRenderer?.flexColumns;
            if (!flexColumns) continue;

            // Judul Lagu
            const title = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
            
            // ID Video/Lagu
            const videoId = item?.musicResponsiveListItemRenderer?.playlistItemData?.videoId || 
                            flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

            // Nama Artis / Channel Topic
            const artistRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            let artist = artistRuns.map(r => r.text).join('').replace(' - Topic', '').trim();

            // Durasi jika ada
            const durationText = artistRuns[artistRuns.length - 1]?.text || '0:00';
            const parts = durationText.split(':').map(Number);
            let durationSeconds = 0;
            if (parts.length === 2 && !isNaN(parts[0])) durationSeconds = parts[0] * 60 + parts[1];

            if (title && videoId) {
              tracks.push({
                id: videoId,
                title: title,
                artist: artist || "Official Artist",
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: durationSeconds,
                isOfficial: true
              });
            }
          }
        }

        // Fallback jika YouTube Music tidak memberikan struktur shelf
        if (tracks.length === 0) {
          // Cari ulang via endpoint umum dengan filter Topic
          const fallbackRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'id', gl: 'ID' } },
              query: `${q} Topic Official Audio`
            })
          });

          const fbData = await fallbackRes.json();
          const contents = fbData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

          for (const item of contents) {
            const video = item.videoRenderer;
            if (video && video.videoId) {
              tracks.push({
                id: video.videoId,
                title: video.title?.runs?.[0]?.text || 'Unknown',
                artist: (video.ownerText?.runs?.[0]?.text || '').replace(' - Topic', ''),
                thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                duration: 0,
                isOfficial: true
              });
            }
          }
        }

        if (tracks.length === 0) {
          return new Response(JSON.stringify({ error: "Lagu tidak ditemukan." }), { status: 404, headers });
        }

        return new Response(JSON.stringify(tracks), { headers });
      }

      // 2. FITUR STREAM AUDIO
      if (id) {
        let audioUrl = null;

        try {
          const cobaltRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
              url: `https://www.youtube.com/watch?v=${id}`,
              downloadMode: "audio",
              audioFormat: "mp3"
            })
          });

          if (cobaltRes.ok) {
            const cobaltData = await cobaltRes.json();
            if (cobaltData.url) audioUrl = cobaltData.url;
          }
        } catch (e) {}

        if (!audioUrl) {
          const fallbackInstances = [
            `https://invidious.privacydev.net/api/v1/videos/${id}`,
            `https://vid.pugil.cc/api/v1/videos/${id}`
          ];

          for (const instance of fallbackInstances) {
            try {
              const res = await fetch(instance);
              if (res.ok) {
                const data = await res.json();
                const adaptive = data.adaptiveFormats || [];
                const audio = adaptive.filter(f => f.type?.includes('audio')).pop();
                if (audio && audio.url) {
                  audioUrl = audio.url;
                  break;
                }
              }
            } catch (e) { continue; }
          }
        }

        if (!audioUrl) {
          return new Response(JSON.stringify({ error: "Gagal mengambil stream audio." }), { status: 500, headers });
        }

        return new Response(JSON.stringify({
          id: id,
          coverUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          audioUrl: audioUrl
        }), { headers });
      }

      return new Response(JSON.stringify({ error: "Gunakan ?q= untuk mencari lagu resmi atau ?id= untuk memutar." }), { headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal Error: " + err.message }), { status: 500, headers });
    }
  }
};
