import {test} from 'node:test';
import assert from 'node:assert/strict';

import {normalizeProjectSpec, validateSvg} from '../src/lib/ai/project-spec.js';

const svg = color => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="40" fill="' + color + '"/>' +
    '</svg>';

test('project spec accepts multiple costumes, a new sprite, a backdrop, and scripts', () => {
    const project = normalizeProjectSpec({
        costumes: [
            {name: '正面', svg: svg('#ff0000')},
            {name: '横向き', svg: svg('#00ff00')}
        ],
        sprites: [{
            name: 'リンゴ',
            x: 20,
            y: 100,
            costumes: [
                {name: '通常', svg: svg('#ff0000')},
                {name: 'キャッチ', svg: svg('#00ff00')}
            ],
            scripts: [[{opcode: 'event_whenflagclicked'}]]
        }],
        backdrops: [{name: '草原', svg: svg('#00aa00')}],
        scripts: [[{opcode: 'event_whenflagclicked'}]]
    });

    assert.equal(project.costumes.length, 2);
    assert.equal(project.sprites.length, 1);
    assert.equal(project.sprites[0].costumes.length, 2);
    assert.equal(project.sprites[0].scripts.length, 1);
    assert.equal(project.backdrops.length, 1);
    assert.equal(project.scripts.length, 1);
});

test('project spec accepts an assets-only background response', () => {
    const project = normalizeProjectSpec({
        backdrops: [{name: '夜空', svg: svg('#000033')}]
    });

    assert.equal(project.backdrops[0].name, '夜空');
    assert.equal(project.scripts.length, 0);
});

test('project spec clamps new sprite coordinates to the stage area', () => {
    const project = normalizeProjectSpec({
        sprites: [{
            name: 'Player',
            x: 999,
            y: -999,
            costumes: [{name: 'Idle', svg: svg('#ff0000')}]
        }]
    });

    assert.equal(project.sprites[0].x, 220);
    assert.equal(project.sprites[0].y, -160);
});

test('SVG validation rejects executable elements and external references', () => {
    assert.throws(() => validateSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>'
    ), /使用できない/);
    assert.throws(() => validateSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>'
    ), /使用できない/);
});

test('project spec rejects invalid scripts and empty projects', () => {
    assert.throws(() => normalizeProjectSpec({scripts: [[{type: 'not-an-opcode'}]]}), /ブロック/);
    assert.throws(() => normalizeProjectSpec({costumes: [], sprites: [], backdrops: []}), /ありません/);
});

test('project spec enforces per-target costume limits', () => {
    assert.throws(() => normalizeProjectSpec({
        costumes: Array.from({length: 9}, (_, index) => ({
            name: 'Costume ' + index,
            svg: svg('#ffffff')
        }))
    }), /上限/);
});
