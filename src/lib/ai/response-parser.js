import {normalizeProgram} from './json-to-blocks.js';

const findJsonEnd = (text, start) => {
    const stack = [text[start]];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '{' || char === '[') {
            stack.push(char);
        } else if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (stack.pop() !== expected) return -1;
            if (stack.length === 0) return i + 1;
        }
    }
    return -1;
};

const isProgramJSON = value => {
    try {
        const program = normalizeProgram(value);
        return program.scripts.length > 0 && program.scripts.every(script =>
            script.length > 0 && script.every(block =>
                block && typeof block === 'object' && !Array.isArray(block) &&
                typeof block.opcode === 'string'
            )
        );
    } catch (e) {
        return false;
    }
};

/**
 * Split plain assistant text around valid, unfenced Scratch program JSON.
 * Only JSON accepted by normalizeProgram and containing opcode blocks is promoted.
 * @param {string} text assistant text without Markdown code fences
 * @returns {Array<{type: string, content: string, lang?: string}>} display segments
 */
const splitBareJsonSegments = text => {
    const segments = [];
    let last = 0;
    let cursor = 0;

    while (cursor < text.length) {
        const char = text[cursor];
        if (char !== '{' && char !== '[') {
            cursor++;
            continue;
        }

        const end = findJsonEnd(text, cursor);
        if (end === -1) {
            cursor++;
            continue;
        }

        const candidate = text.slice(cursor, end);
        let value;
        let parsed = false;
        try {
            value = JSON.parse(candidate);
            parsed = true;
        } catch (e) {
            // Not a complete JSON value; keep scanning for a later candidate.
        }

        if (parsed && isProgramJSON(value)) {
            if (cursor > last) {
                segments.push({type: 'text', content: text.slice(last, cursor)});
            }
            segments.push({type: 'code', lang: 'scratch-blocks', content: candidate});
            last = end;
        }

        // A balanced JSON value is one unit. Do not mistake nested arrays in an
        // unrelated JSON object for a separate Scratch program.
        cursor = end;
    }

    if (last < text.length) {
        segments.push({type: 'text', content: text.slice(last)});
    }
    if (segments.length === 0) {
        segments.push({type: 'text', content: text});
    }
    return segments;
};

export {
    splitBareJsonSegments
};
