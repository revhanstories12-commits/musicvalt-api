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

    // Daftar instance Invidious & Piped publik yang aktif
    const SEARCH_INSTANCES = [
      "https://invidious.privacydev.net",
      "https://vid.pugil.cc",
      "https://inv.tux.pizza",
      "https://pipedapi.kavin.rocks"
    ];

    try {
      // 1. FITUR PENCARIAN
      if (q) {
        let tracks = [];
        
        for (const instance of SEARCH_INSTANCES) {
          try {
            if (instance.includes('invidious') || instance.includes('pugil') || instance.includes('tux')) {
              // API Invidious
              const res = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(q + " Official Audio")}&type=video`);
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                  tracks = data.map(item => ({
                    id: item.videoId,
                    title: item.title,
                    artist: item.author ? item.author.replace(' - Topic', '') : 'Unknown Artist',
                    thumbnail: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                    duration: item.lengthSeconds
                  }));
                  break; // Sukses, keluar dari loop
                }
              }
            } else {
              // API Piped Fallback
              const res = await fetch(`${instance}/search?q=${encodeURIComponent(q + " Topic Official Audio")}`);
              if (res.ok) {
                const data = await res.json();
                if (data.items) {
                  tracks = data.items.filter(i => i.type === 'stream').map(item => ({
                    id: item.url ? item.url.replace('/watch?v=', '') : '',
                    title: item.title,
                    artist: item.uploaderName ? item.uploaderName.replace(' - Topic', '') : 'Unknown Artist',
                    thumbnail: item.thumbnail,
                    duration: item.duration
                  }));
                  break;
                }
              }
            }
          } catch (e) {
            continue; // Coba instance berikutnya jika gagal
          }
        }

        if (tracks.length === 0) {
          return new Response(JSON.stringify({ error: "Gagal mengambil lagu, semua server sibuk. Coba beberapa saat lagi." }), { status: 503, headers });
        }

        return new Response(JSON.stringify(tracks), { headers });
      }

      // 2. FITUR AMBIL AUDIO STREAM
      if (id) {
        let streamInfo = null;

        for (const instance of SEARCH_INSTANCES) {
          try {
            if (instance.includes('invidious') || instance.includes('pugil') || instance.includes('tux')) {
              const res = await fetch(`${instance}/api/v1/videos/${id}`);
              if (res.ok) {
                const data = await res.json();
                const adaptive = data.adaptiveFormats || [];
                const audio = adaptive.filter(f => f.type?.includes('audio')).pop();

                if (audio && audio.url) {
                  streamInfo = {
                    id,
                    title: data.title,
                    artist: data.author ? data.author.replace(' - Topic', '') : '',
                    coverUrl: data.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
                    duration: data.lengthSeconds,
                    audioUrl: audio.url
                  };
                  break;
                }
              }
            } else {
              const res = await fetch(`${instance}/streams/${id}`);
              if (res.ok) {
                const data = await res.json();
                const audioStreams = data.audioStreams || [];
                const bestAudio = audioStreams.find(s => s.mimeType?.includes('audio/mp4')) || audioStreams[0];
                if (bestAudio) {
                  streamInfo = {
                    id,
                    title: data.title,
                    artist: data.uploader ? data.uploader.replace(' - Topic', '') : '',
                    coverUrl: data.thumbnailUrl,
                    duration: data.duration,
                    audioUrl: bestAudio.url
                  };
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!streamInfo) {
          return new Response(JSON.stringify({ error: "Gagal memutar audio, coba ID lain." }), { status: 500, headers });
        }

        return new Response(JSON.stringify(streamInfo), { headers });
      }

      return new Response(JSON.stringify({ error: "Gunakan parameter ?q= atau ?id=" }), { headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
};
