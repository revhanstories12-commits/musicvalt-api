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
      // FITUR 1: PENCARIAN LANGSUNG KE YOUTUBE (INNERTUBE API)
      if (q) {
        const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            query: `${q} Official Audio`
          })
        });

        const ytData = await ytRes.json();
        const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

        const tracks = [];

        for (const item of contents) {
          const video = item.videoRenderer;
          if (video && video.videoId) {
            const title = video.title?.runs?.[0]?.text || 'Unknown Title';
            const artist = video.ownerText?.runs?.[0]?.text ? video.ownerText.runs[0].text.replace(' - Topic', '') : 'Unknown Artist';
            const durationText = video.lengthText?.simpleText || '0:00';
            
            // Konversi durasi teks (contoh "3:45") ke detik
            const parts = durationText.split(':').map(Number);
            let durationSeconds = 0;
            if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1];
            if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];

            tracks.push({
              id: video.videoId,
              title: title,
              artist: artist,
              thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
              duration: durationSeconds
            });
          }
        }

        if (tracks.length === 0) {
          return new Response(JSON.stringify({ error: "Lagu tidak ditemukan." }), { status: 404, headers });
        }

        return new Response(JSON.stringify(tracks), { headers });
      }

      // FITUR 2: STREAM AUDIO VIA COBALT / INVIDIOUS FALLBACK
      if (id) {
        const STREAM_APIS = [
          `https://api.cobalt.tools/api/json`,
          `https://invidious.privacydev.net/api/v1/videos/${id}`,
          `https://vid.pugil.cc/api/v1/videos/${id}`
        ];

        let audioUrl = null;
        let title = "";
        let artist = "";

        // Opsi A: Coba via Cobalt API
        try {
          const cobaltRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              url: `https://www.youtube.com/watch?v=${id}`,
              downloadMode: "audio",
              audioFormat: "mp3"
            })
          });

          if (cobaltRes.ok) {
            const cobaltData = await cobaltRes.json();
            if (cobaltData.url) {
              audioUrl = cobaltData.url;
            }
          }
        } catch (e) {}

        // Opsi B: Fallback ke Invidious jika Cobalt gagal
        if (!audioUrl) {
          for (const instance of [STREAM_APIS[1], STREAM_APIS[2]]) {
            try {
              const res = await fetch(instance);
              if (res.ok) {
                const data = await res.json();
                const adaptive = data.adaptiveFormats || [];
                const audio = adaptive.filter(f => f.type?.includes('audio')).pop();
                if (audio && audio.url) {
                  audioUrl = audio.url;
                  title = data.title;
                  artist = data.author ? data.author.replace(' - Topic', '') : '';
                  break;
                }
              }
            } catch (e) { continue; }
          }
        }

        if (!audioUrl) {
          return new Response(JSON.stringify({ error: "Gagal mengambil link audio." }), { status: 500, headers });
        }

        return new Response(JSON.stringify({
          id: id,
          title: title || "Audio Track",
          artist: artist || "Artist",
          coverUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          audioUrl: audioUrl
        }), { headers });
      }

      return new Response(JSON.stringify({ error: "Gunakan ?q= untuk mencari atau ?id= untuk memutar lagu." }), { headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal Error: " + err.message }), { status: 500, headers });
    }
  }
};
