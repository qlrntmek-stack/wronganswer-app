// Netlify Function: Google Vision API 프록시
// 브라우저 CORS 문제를 서버에서 우회

exports.handler = async (event) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { image } = JSON.parse(event.body);
    if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image' }) };

    const API_KEY = process.env.GOOGLE_API_KEY;
    if (!API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

    // Google Vision API 호출 (서버에서)
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 300 }],
            imageContext: { languageHints: ['ko', 'en'] }
          }]
        })
      }
    );

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
