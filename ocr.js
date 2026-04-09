// Netlify Function: Google Vision API 프록시 + 손글씨 필터링

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { image, imageWidth, imageHeight } = JSON.parse(event.body);
    if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image' }) };

    const API_KEY = process.env.GOOGLE_API_KEY;
    if (!API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 500 }],
            imageContext: { languageHints: ['ko', 'en'] }
          }]
        })
      }
    );

    const data = await res.json();
    const resp = data.responses?.[0];
    if (resp?.error) return { statusCode: 200, headers, body: JSON.stringify({ error: resp.error.message }) };

    // 단어 단위로 손글씨 필터링
    const blocks = resp?.fullTextAnnotation?.pages?.[0]?.blocks || [];
    const handwritingRegions = [];

    for (const block of blocks) {
      for (const para of (block.paragraphs || [])) {
        for (const word of (para.words || [])) {
          const conf = word.confidence || 1;
          const txt = (word.symbols || []).map(s => s.text).join('');
          if (!txt.trim()) continue;

          // 손글씨 판별 로직
          const isHandwriting =
            conf < 0.85 ||                                          // 신뢰도 낮음
            /^\d+\.?\d*$/.test(txt) ||                             // 숫자만 (답안)
            /[=+\-×÷²³√∫①②③○△□]/.test(txt) ||               // 수식 기호
            (/[가-힣]/.test(txt) && /\d/.test(txt)) ||            // 한글+숫자
            (txt.length <= 4 && conf < 0.92);                      // 짧은 단어+낮은 신뢰도

          if (isHandwriting) {
            const verts = word.boundingBox?.vertices || [];
            const xs = verts.map(v => v.x || 0);
            const ys = verts.map(v => v.y || 0);
            handwritingRegions.push({
              text: txt,
              confidence: conf,
              bbox: {
                x0: Math.max(0, Math.min(...xs)),
                y0: Math.max(0, Math.min(...ys)),
                x1: Math.min(imageWidth || 9999, Math.max(...xs)),
                y1: Math.min(imageHeight || 9999, Math.max(...ys)),
              }
            });
          }
        }
      }
    }

    // 인접한 단어 병합 (같은 줄)
    const merged = mergeRegions(handwritingRegions, imageWidth || 1000);

    return { statusCode: 200, headers, body: JSON.stringify({ regions: merged, total: merged.length }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function mergeRegions(regions, imgWidth) {
  if (!regions.length) return [];
  const sorted = [...regions].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const merged = [];
  let group = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = group[group.length - 1];
    const sameRow = cur.bbox.y0 < last.bbox.y1 + 20;
    const close = cur.bbox.x0 < last.bbox.x1 + imgWidth * 0.15;

    if (sameRow && close) {
      group.push(cur);
    } else {
      merged.push(collapse(group));
      group = [cur];
    }
  }
  merged.push(collapse(group));
  return merged;
}

function collapse(group) {
  return {
    text: group.map(r => r.text).join(' '),
    bbox: {
      x0: Math.min(...group.map(r => r.bbox.x0)),
      y0: Math.min(...group.map(r => r.bbox.y0)),
      x1: Math.max(...group.map(r => r.bbox.x1)),
      y1: Math.max(...group.map(r => r.bbox.y1)),
    }
  };
}
