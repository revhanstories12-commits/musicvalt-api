addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')

  if (!query) {
    return new Response(JSON.stringify({ error: "Parameter 'q' wajib diisi!" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  try {
    const ytResponse = await fetch("https://music.youtube.com/youtubei/v1/search?alt=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20231214.00.00",
            hl: "en",
            gl: "US"
          }
        },
        query: query
      })
    })

    if (!ytResponse.ok) {
      throw new Error("Gagal terhubung ke YouTube Music")
    }

    const data = await ytResponse.json()
    const formattedResults = []

    // Pencarian rekursif untuk menemukan semua objek musicResponsiveListItemRenderer (item lagu)
    function searchItems(obj) {
      if (!obj || typeof obj !== 'object') return

      if (obj.musicResponsiveListItemRenderer) {
        const item = obj.musicResponsiveListItemRenderer
        
        // Ambil Video ID
        const videoId = item.playlistItemData?.videoId || 
                        item.doubleTapCommand?.watchEndpoint?.videoId ||
                        item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId

        if (videoId) {
          // Ambil Judul Lagu
          const title = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
          
          // Ambil Nama Artist / Channel
          const flex2Runs = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
          const artist = flex2Runs.length > 0 ? flex2Runs[0].text : "Unknown Artist"

          // Ambil Thumbnail
          const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
          const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""

          // Cegah duplikasi ID dalam hasil
          if (!formattedResults.some(r => r.videoId === videoId)) {
            formattedResults.push({
              title: title,
              videoId: videoId,
              artist: artist,
              subscribers: "Official Track",
              thumbnail: thumbnail,
              type: "video"
            })
          }
        }
      }

      for (const key of Object.keys(obj)) {
        searchItems(obj[key])
      }
    }

    searchItems(data)

    return new Response(JSON.stringify({ results: formattedResults }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: "Gagal mengambil data dari YouTube Music.", detail: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}
