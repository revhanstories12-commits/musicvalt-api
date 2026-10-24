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
    // Request langsung ke YouTube Music InnerTube API (Tanpa API Key, tanpa instance pihak ketiga)
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
    
    // Parsing data dari struktur YouTube Music InnerTube
    const contents = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
    
    let formattedResults = []

    for (const section of contents) {
      const items = section.musicShelfRenderer?.contents || []
      for (const item of items) {
        const itemData = item.musicResponsiveListItemRenderer
        if (!itemData) continue

        const videoId = itemData.playlistItemData?.videoId || itemData.doubleTapCommand?.watchEndpoint?.videoId
        if (!videoId) continue

        const title = itemData.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
        const artist = itemData.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Artist"
        
        // Ambil Thumbnail ukuran tertinggi
        const thumbnails = itemData.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
        const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""

        formattedResults.push({
          title: title,
          videoId: videoId,
          artist: artist,
          subscribers: "Official Track", // YouTube Music Topic Track
          thumbnail: thumbnail,
          type: "video"
        })
      }
    }

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
