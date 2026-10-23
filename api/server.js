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

    const API_INSTANCES = [
      "https://pipedapi.kavin.rocks",
      "https://pipedapi.leptons.xyz",
      "https://piped-api.privacy.com.de"
    ];

    try {
      if (q) {
        let searchData = null;
        for (const instance of API_INSTANCES) {
          try {
            const res = await fetch(`${instance}/search?q=${encodeURIComponent(q + " Topic Official Audio")}`);
            const text = await res.text();
            if (text.startsWith('{') || text.startsWith('[')) {
              searchData = JSON.parse(text);
              break;
            }
          } catch (e) { continue; }
        }

        if (!searchData) {
          return new Response(JSON.stringify({ error: "Server sibuk" }), { status: 500, headers });
        }

        const tracks = (searchData.items || []).filter(item => item.type === 'stream').map(item => ({
          id: item.url ? item.url.replace('/watch?v=', '') : '',
          title: item.title || 'Unknown',
          artist: item.uploaderName ? item.uploaderName.replace(' - Topic', '') : 'Unknown',
          thumbnail: item.thumbnail || '',
          duration: item.duration || 0
        }));

        return new Response(JSON.stringify(tracks), { headers });
      }

      if (id) {
        let streamData = null;
        for (const instance of API_INSTANCES) {
          try {
            const res = await fetch(`${instance}/streams/${id}`);
            const text = await res.text();
            if (text.startsWith('{') || text.startsWith('[')) {
              streamData = JSON.parse(text);
              break;
            }
          } catch (e) { continue; }
        }

        if (!streamData) {
          return new Response(JSON.stringify({ error: "Gagal stream" }), { status: 500, headers });
        }

        const audioStreams = streamData.audioStreams || [];
        const bestAudio = audioStreams.find(s => s.mimeType?.includes('audio/mp4')) || audioStreams[0];

        return new Response(JSON.stringify({
          id,
          title: streamData.title,
          artist: streamData.uploader ? streamData.uploader.replace(' - Topic', '') : '',
          coverUrl: streamData.thumbnailUrl,
          audioUrl: bestAudio ? bestAudio.url : null
        }), { headers });
      }

      return new Response(JSON.stringify({ error: "Gunakan ?q= atau ?id=" }), { headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
};
