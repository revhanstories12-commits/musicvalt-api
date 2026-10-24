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

  // Daftar instance Piped publik cadangan
  const instances = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.privacy.com.de",
    "https://pipedapi.leptons.xyz"
  ]

  let searchResults = null

  for (const instance of instances) {
    try {
      const response = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=all`)
      if (response.ok) {
        const json = await response.json()
        searchResults = json.items || []
        break
      }
    } catch (e) {
      continue 
    }
  }

  if (!searchResults) {
    return new Response(JSON.stringify({ error: "Gagal mengambil data dari server." }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Format data agar mencakup artist, subscriber, durasi, dan playlist
  const formattedData = searchResults.map(item => {
    return {
      title: item.title || "Unknown Title",
      videoId: item.url && item.url.includes("/watch?v=") ? item.url.split("/watch?v=")[1] : item.url,
      artist: item.uploaderName || "Unknown Artist",
      subscribers: item.uploaderSubscriberCount || 0,
      thumbnail: item.thumbnail || "",
      duration: item.duration || 0,
      type: item.type || "video", // Bisa berupa video, channel, atau playlist
      playlistName: item.type === "playlist" ? item.title : null
    }
  })

  return new Response(JSON.stringify({ results: formattedData }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    }
  })
}
