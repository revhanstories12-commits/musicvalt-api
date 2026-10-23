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
        for (const instance
