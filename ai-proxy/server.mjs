// Tiny zero-dependency proxy for the AI sidebar.
// Keeps your API key on the server and forwards OpenAI-compatible requests.
//
//   AI_API_KEY=sk-... node ai-proxy/server.mjs
//
// Env vars:
//   AI_API_KEY        (required) key for the upstream API
//   AI_UPSTREAM       upstream base URL (default https://api.openai.com/v1)
//   AI_MODEL          force a model (optional; otherwise the client's model is used)
//   AI_ALLOWED_ORIGIN CORS origin to allow (default *; set to your site in production)
//   PORT              default 8787
//   AI_MAX_REQ_PER_MIN per-IP rate limit (default 20)

import http from 'node:http';
import {Readable} from 'node:stream';

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = (process.env.AI_UPSTREAM || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.AI_API_KEY || '';
const FORCE_MODEL = process.env.AI_MODEL || '';
const ALLOWED_ORIGIN = process.env.AI_ALLOWED_ORIGIN || '*';
const MAX_PER_MIN = Number(process.env.AI_MAX_REQ_PER_MIN || 20);
const MAX_BODY = 200 * 1024;

if (!API_KEY) {
    console.warn('[ai-proxy] AI_API_KEY is not set. Upstream requests will probably fail.');
}

const hits = new Map();
const rateLimited = ip => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
    list.push(now);
    hits.set(ip, list);
    return list.length > MAX_PER_MIN;
};

const cors = res => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
        res.writeHead(404, {'Content-Type': 'application/json'}).end('{"error":"not found"}');
        return;
    }
    const ip = req.socket.remoteAddress;
    if (rateLimited(ip)) {
        res.writeHead(429, {'Content-Type': 'application/json'}).end('{"error":"too many requests"}');
        return;
    }

    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
            res.writeHead(413).end('{"error":"request too large"}');
            return;
        }
        chunks.push(chunk);
    }

    let body;
    try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
        res.writeHead(400).end('{"error":"invalid json"}');
        return;
    }
    if (FORCE_MODEL) body.model = FORCE_MODEL;
    body.max_tokens = Math.min(Number(body.max_tokens) || 2000, 4000);

    try {
        const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify(body)
        });
        res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
            'Cache-Control': 'no-cache'
        });
        if (upstream.body) {
            Readable.fromWeb(upstream.body).pipe(res);
        } else {
            res.end();
        }
    } catch (e) {
        res.writeHead(502, {'Content-Type': 'application/json'})
            .end(JSON.stringify({error: `upstream error: ${e.message}`}));
    }
});

server.listen(PORT, () => {
    console.log(`[ai-proxy] listening on http://localhost:${PORT}/v1 -> ${UPSTREAM}`);
});
