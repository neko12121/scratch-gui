/**
 * Minimal client for any OpenAI-compatible Chat Completions API.
 * Works with: OpenAI, OpenRouter, Groq, Google Gemini (OpenAI compat endpoint),
 * local Ollama / LM Studio, or the bundled ai-proxy server (recommended for
 * public deployments so the API key stays on the server).
 */

const STORAGE_KEY = 'tw:ai-sidebar:settings';

const DEFAULT_SETTINGS = {
    // Use the bundled proxy by default (see ai-proxy/README.md)
    endpoint: 'http://localhost:8787/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.4
};

const loadSettings = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (e) {
        // ignore
    }
    return Object.assign({}, DEFAULT_SETTINGS);
};

const saveSettings = settings => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        // ignore
    }
};

/**
 * @param {object} settings endpoint/apiKey/model/temperature
 * @param {Array<{role: string, content: string}>} messages chat messages
 * @param {object} [options] options
 * @param {AbortSignal} [options.signal] abort signal
 * @param {function(string): void} [options.onToken] streaming callback (full text so far)
 * @returns {Promise<string>} assistant reply
 */
const chat = async (settings, messages, options = {}) => {
    const endpoint = settings.endpoint.replace(/\/+$/, '');
    const headers = {'Content-Type': 'application/json'};
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

    const stream = typeof options.onToken === 'function';
    const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
            model: settings.model,
            temperature: Number(settings.temperature),
            messages,
            stream
        })
    });

    if (!res.ok) {
        let detail = '';
        try {
            detail = await res.text();
        } catch (e) {
            // ignore
        }
        throw new Error(`AI API エラー (${res.status}): ${detail.slice(0, 300)}`);
    }

    if (!stream || !res.body || !res.body.getReader) {
        const data = await res.json();
        return data.choices && data.choices[0] && data.choices[0].message ?
            data.choices[0].message.content || '' :
            '';
    }

    // Server-sent events streaming
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
                const json = JSON.parse(payload);
                const delta = json.choices && json.choices[0] && json.choices[0].delta;
                if (delta && delta.content) {
                    text += delta.content;
                    options.onToken(text);
                }
            } catch (e) {
                // partial line, ignore
            }
        }
    }
    return text;
};

export {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    chat
};
