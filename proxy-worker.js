// CORS-прокси для плагина Anixart (Cloudflare Workers).
// Пропускает только запросы к anixart.site.
// Использование: https://<worker>.workers.dev/?url=<encoded url>

const ALLOWED_HOST = 'anixart.site';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
};

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

        const target = new URL(request.url).searchParams.get('url');
        let url;
        try { url = new URL(target); } catch (e) { return new Response('bad url', { status: 400, headers: CORS }); }
        if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
            return new Response('forbidden', { status: 403, headers: CORS });
        }

        const res = await fetch(url.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
            cf: { cacheTtl: 300 }
        });

        return new Response(res.body, {
            status: res.status,
            headers: { ...CORS, 'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8' }
        });
    }
};
