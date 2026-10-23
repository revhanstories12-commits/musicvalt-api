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
      // FITUR 1: PENCARIAN KHUSUS YOUTUBE MUSIC (MUSIC ONLY)
      if (q) {
        const response = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-YouTube-Client-Name': '67',
            'X-YouTube-Client-Version': '1.20240101.01.00'
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
            query: q,
            params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D" // Parameter wajib untuk menyaring HANYA LAGU RESMI (Songs)
          })
        });

        const data = await response.json();
        
        // Parsing hasil khusus YouTube Music
        const shelf = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        
        const tracks = [];

        for (const section of shelf) {
          const contents = section?.musicShelfRenderer?.contents || [];
          for (const item of contents) {
            const listItem = item?.musicResponsiveListItemRenderer;
            if (!listItem) continue;

            const videoId = listItem?.playlistItemData?.videoId || 
                            listItem?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

            const title = listItem?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
            
            // Mengambil info Artis & Album dari YouTube Music
            const flexRuns = listItem?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            const artist = flexRuns.map(r => r.text).join('').replace(' • ', ' - ').replace(' - Topic', '').trim();

            if (videoId && title) {
              tracks.push({
                id: videoId,
                title: title,
                artist: artist || "Official Artist",
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                isMusicTrack: true
              });
            }
          }
        }

        if (tracks.length === 0) {
          return new Response(JSON.stringify({ error: "Lagu resmi tidak ditemukan / API dibatasi oleh YouTube." }), { status: 404, headers });
        }

        return new Response(JSON.stringify(tracks), { headers });
      }

      // FITUR 2: STREAM AUDIO
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
          return new Response(JSON.stringify({ error: "Gagal mengambil stream audio." }), { status: 500, headers });
        }

        return new Response(JSON.stringify({
          id: id,
          coverUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          audioUrl: audioUrl
        }), { headers });
      }

      return new Response(JSON.stringify({ error: "Gunakan ?q= untuk mencari lagu atau ?id= untuk memutar." }), { headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
};
