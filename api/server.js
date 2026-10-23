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
      // 1. PENCARIAN KHUSUS YOUTUBE MUSIC (OFFICIAL SONGS / TOPIC ONLY)
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
                clientName: 'WEB_REMIX', // Mode YouTube Music
                clientVersion: '1.20240101.01.00',
                hl: 'id',
                gl: 'ID'
              }
            },
            query: q,
            // Filter rahasia YouTube untuk memunculkan HANYA kategori "Lagu Resmi" (Songs)
            params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D" 
          })
        });

        const ytData = await ytRes.json();
        
        // Ekstraksi data hasil pencarian
        const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

        const tracks = [];

        for (const item of contents) {
          const video = item.videoRenderer;
          if (video && video.videoId) {
            const title = video.title?.runs?.[0]?.text || 'Unknown Title';
            
            // Mengambil nama artis dan membersihkan teks "- Topic"
            let rawArtist = video.ownerText?.runs?.[0]?.text || video.longBylineText?.runs?.[0]?.text || 'Unknown Artist';
            const cleanArtist = rawArtist.replace(' - Topic', '').trim();

            // Memastikan durasi berbentuk detik
            const durationText = video.lengthText?.simpleText || '0:00';
            const parts = durationText.split(':').map(Number);
            let durationSeconds = 0;
            if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1];
            if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];

            tracks.push({
              id: video.videoId,
              title: title,
              artist: cleanArtist,
              // Mengambil thumbnail kualitas tinggi dari album resmi
              thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
              duration: durationSeconds,
              isOfficial: true
            });
          }
        }

        // Jika filter ketat kosong, coba cari tanpa parameter
        if (tracks.length === 0) {
          return new Response(JSON.stringify({ error: "Lagu resmi tidak ditemukan." }), { status: 404, headers });
        }

        return new Response(JSON.stringify(tracks), { headers });
      }

      // 2. STREAM AUDIO LINK
      if (id) {
        let audioUrl = null;

        // Mencoba Cobalt API dulu
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

        // Fallback jika Cobalt sibuk
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
