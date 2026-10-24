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

  // Daftar instance Invidious publik sebagai pengganti Piped
  const instances = [
    "https://invidious.privacydev.net",
    "https://vid.puffyan.us",
    "https://inv.nadeko.net"
  ]

  let searchResults = null

  for (const instance of instances) {
    try {
      const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (response.ok) {
        const json = await response.json()
        searchResults = json || []
        break
      }
    } catch (e) {
      continue 
    }
  }

  if (!searchResults || searchResults.length === 0) {
    return new Response(JSON.stringify({ error: "Gagal mengambil data dari server Invidious." }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Format data agar mencakup artist, thumbnail, durasi, dll
  const formattedData = searchResults.map(item => {
    return {
      title: item.title || "Unknown Title",
      videoId: item.videoId || "",
      artist: item.author || "Unknown Artist",
      subscribers: item.subCountText || "0",
      thumbnail: item.videoThumbnails?.[0]?.url || "",
      duration: item.lengthSeconds || 0,
      type: "video"
    }
  })

  return new Response(JSON.stringify({ results: formattedData }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    }
  })
}
