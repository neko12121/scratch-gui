import {normalizeProgram} from './json-to-blocks.js';

const MAX_SVG_LENGTH = 180000;
const MAX_TOTAL_SVG_LENGTH = 800000;
const MAX_COSTUMES = 8;
const MAX_SPRITES = 8;
const MAX_BACKDROPS = 4;
const MAX_TOTAL_ASSETS = 24;

const ALLOWED_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'
]);
const ALLOWED_ATTRIBUTES = new Set([
    'xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'cx', 'cy',
    'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'd', 'points',
    'transform', 'version', 'preserveAspectRatio'
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeName = (value, fallback) => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return value.trim().slice(0, 80);
};

/**
 * Validate the small, self-contained SVG subset accepted from AI responses.
 * The SVG is sanitized again by Scratch's existing costumeUpload pipeline.
 */
const validateSvg = svg => {
    if (typeof svg !== 'string' || svg.length === 0 || svg.length > MAX_SVG_LENGTH) {
        throw new Error('SVGは1つ180KB以下にしてください。');
    }
    if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(svg) ||
        !/\bxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg) ||
        !/\bviewBox\s*=\s*["'][^"']+["']/i.test(svg)) {
        throw new Error('SVGには正しいsvg要素、xmlns、viewBoxが必要です。');
    }
    if (/<!DOCTYPE|<!ENTITY|<\?|<!--|<\s*(?:script|foreignObject|image|use|iframe|audio|video|style|animate|set)\b|\son[a-z]+\s*=|(?:href|xlink:href|src)\s*=|url\s*\(|javascript:/i.test(svg)) {
        throw new Error('SVGに使用できない要素または属性が含まれています。');
    }

    const tagPattern = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)\b([^>]*)>/g;
    let tagMatch;
    let tagCount = 0;
    while ((tagMatch = tagPattern.exec(svg)) !== null) {
        const closing = tagMatch[1] === '/';
        const tagName = tagMatch[2];
        const attributes = tagMatch[3];
        if (!ALLOWED_TAGS.has(tagName)) {
            throw new Error('SVGに使用できない要素があります: ' + tagName);
        }
        tagCount++;
        if (closing) continue;

        const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g;
        let attributeMatch;
        let remainder = attributes;
        while ((attributeMatch = attributePattern.exec(attributes)) !== null) {
            const attributeName = attributeMatch[1];
            if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
                throw new Error('SVGに使用できない属性があります: ' + attributeName);
            }
            remainder = remainder.replace(attributeMatch[0], '');
        }
        if (remainder.replace(/[\s/]/g, '')) {
            throw new Error('SVGの属性形式が正しくありません。');
        }
    }
    if (tagCount < 2) throw new Error('SVGの内容が空です。');
    return svg;
};

const normalizeAsset = (asset, fallbackName) => {
    if (!isObject(asset)) throw new Error('素材の形式が正しくありません。');
    return {
        name: normalizeName(asset.name, fallbackName),
        svg: validateSvg(asset.svg)
    };
};

const normalizeScripts = scripts => {
    if (scripts === undefined || scripts === null) return [];
    if (!Array.isArray(scripts)) throw new Error('scriptsは配列で指定してください。');
    if (scripts.length === 0) return [];
    const normalized = normalizeProgram({scripts: scripts});
    const visit = block => {
        if (!isObject(block) || typeof block.opcode !== 'string' || !block.opcode) {
            throw new Error('scripts内に正しくないブロックがあります。');
        }
        const inputs = block.inputs || {};
        if (!isObject(inputs)) throw new Error('ブロックのinputsはオブジェクトにしてください。');
        Object.keys(inputs).forEach(key => {
            const value = inputs[key];
            if (Array.isArray(value)) value.forEach(visit);
            else if (isObject(value)) visit(value);
        });
    };
    normalized.scripts.forEach(script => script.forEach(visit));
    return normalized.scripts;
};

/**
 * Normalize a combined AI project response.
 *
 * costumes: costumes for the currently selected sprite
 * sprites: new sprites, each with one or more SVG costumes
 * backdrops: new stage backdrops
 * scripts: Scratch block scripts for the currently selected target
 */
const normalizeProjectSpec = input => {
    let data = input;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (e) {
            throw new Error('プロジェクトJSONを読み込めません: ' + e.message);
        }
    }
    if (!isObject(data)) throw new Error('プロジェクトJSONはオブジェクトにしてください。');

    const rawCostumes = data.costumes === undefined ? [] : data.costumes;
    const rawSprites = data.sprites === undefined ? [] : data.sprites;
    const rawBackdrops = data.backdrops === undefined ? [] : data.backdrops;
    if (!Array.isArray(rawCostumes) || !Array.isArray(rawSprites) || !Array.isArray(rawBackdrops)) {
        throw new Error('costumes、sprites、backdropsは配列で指定してください。');
    }
    if (rawCostumes.length > MAX_COSTUMES || rawSprites.length > MAX_SPRITES ||
        rawBackdrops.length > MAX_BACKDROPS) {
        throw new Error('生成できる素材数の上限を超えています。');
    }

    const costumes = rawCostumes.map((asset, index) =>
        normalizeAsset(asset, 'AIコスチューム' + (index + 1))
    );
    const sprites = rawSprites.map((sprite, index) => {
        if (!isObject(sprite) || !Array.isArray(sprite.costumes) ||
            sprite.costumes.length === 0 || sprite.costumes.length > MAX_COSTUMES) {
            throw new Error('新しいスプライトには1〜8個のコスチュームが必要です。');
        }
        const x = Number.isFinite(sprite.x) ? Math.max(-220, Math.min(220, sprite.x)) : 0;
        const y = Number.isFinite(sprite.y) ? Math.max(-160, Math.min(160, sprite.y)) : 0;
        return {
            name: normalizeName(sprite.name, 'AIスプライト' + (index + 1)),
            x: x,
            y: y,
            costumes: sprite.costumes.map((asset, costumeIndex) =>
                normalizeAsset(asset, 'コスチューム' + (costumeIndex + 1))
            ),
            scripts: normalizeScripts(sprite.scripts)
        };
    });
    const backdrops = rawBackdrops.map((asset, index) =>
        normalizeAsset(asset, 'AI背景' + (index + 1))
    );
    const assetCount = costumes.length + backdrops.length +
        sprites.reduce((sum, sprite) => sum + sprite.costumes.length, 0);
    const totalSvgLength = costumes.concat(backdrops).reduce((sum, asset) =>
        sum + asset.svg.length, 0) + sprites.reduce((sum, sprite) =>
        sum + sprite.costumes.reduce((costumeSum, asset) => costumeSum + asset.svg.length, 0), 0);

    if (assetCount > MAX_TOTAL_ASSETS || totalSvgLength > MAX_TOTAL_SVG_LENGTH) {
        throw new Error('素材の合計サイズまたは個数が上限を超えています。');
    }

    const scripts = normalizeScripts(data.scripts);
    if (assetCount === 0 && scripts.length === 0) {
        throw new Error('追加する素材またはブロックがありません。');
    }
    return {costumes, sprites, backdrops, scripts};
};

export {
    normalizeProjectSpec,
    validateSvg
};
