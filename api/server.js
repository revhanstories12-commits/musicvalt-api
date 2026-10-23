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
      // 1. FITUR PENCARIAN KHUSUS LAGU RESMI (- TOPIC / YOUTUBE MUSIC)
      if (q) {
        // Query dipaksa mencari lagu dari channel Topic resmi
        const searchQuery = `${q} Topic`;

        const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB',
                clientVersion: '2.20240101.00.00',
                hl: 'id',
                gl: 'ID'
              }
            },
            query: searchQuery
          })
        });

        const ytData = await ytRes.json();
        const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

        const tracks = [];

        for (const item of contents) {
          const video = item.videoRenderer;
          if (video && video.videoId) {
            const rawArtist = video.ownerText?.runs?.[0]?.text || '';
            const title = video.title?.runs?.[0]?.text || '';

            // SYARAT KETAT: Harus dari channel "- Topic" atau rilis resmi
            const isTopicChannel = rawArtist.includes('- Topic') || rawArtist.includes('Topic');

            // Abaikan jika video berasal dari Indosiar / TV / Video Klip Sinematik biasa jika kita cuma mau lagu
            if (isTopicChannel) {
              const durationText = video.lengthText?.simpleText || '0:00';
              const parts = durationText.split(':').map(Number);
              let durationSeconds = 0;
              if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1];
              if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];

              tracks.push({
                id: video.videoId,
                title: title,
                artist: rawArtist.replace(' - Topic', '').replace('- Topic', '').trim(),
                thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                duration: durationSeconds,
                isOfficialTopic: true
              });
            }
          }
        }

        // Jika hasil filter ketat "- Topic" tidak ditemukan, ambil pencarian fallback dengan pembersihan
        if (tracks.length === 0) {
          for (const item of contents) {
            const video = item.videoRenderer;
            if (video && video.videoId) {
              const rawArtist = video.ownerText?.runs?.[0]?.text || '';
              const title = video.title?.runs?.[0]?.text || '';

              tracks.push({
                id: video.videoId,
                title: title,
                artist: rawArtist.replace(' - Topic', '').trim(),
                thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                duration: 0,
                isOfficialTopic: false
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
