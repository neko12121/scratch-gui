import {test} from 'node:test';
import assert from 'node:assert/strict';

import {buildSystemMessage} from '../src/lib/ai/prompts.js';
import {normalizeProgram} from '../src/lib/ai/json-to-blocks.js';
import {splitBareJsonSegments} from '../src/lib/ai/response-parser.js';

test('AI prompt requires the supported Scratch block JSON format', () => {
    const message = buildSystemMessage({
        blockCatalog: 'motion_movesteps(STEPS:value<math_number NUM="10">)',
        projectText: '[script 1] event_whenflagclicked'
    });

    assert.match(message, /```scratch-blocks/);
    assert.match(message, /opcode、入力名、フィールド名/);
    assert.match(message, /使えるブロック一覧/);
    assert.ok(message.includes('motion_movesteps(STEPS:value<math_number NUM="10">)'));
    assert.ok(message.includes('[script 1] event_whenflagclicked'));
});

test('normalizeProgram parses a JSON string and defaults to add mode', () => {
    const program = normalizeProgram(JSON.stringify({
        scripts: [[{opcode: 'event_whenflagclicked'}]]
    }));

    assert.equal(program.mode, 'add');
    assert.deepEqual(program.scripts, [[{opcode: 'event_whenflagclicked'}]]);
});

test('normalizeProgram preserves explicit replace mode', () => {
    const program = normalizeProgram({
        mode: 'replace',
        scripts: [[{opcode: 'event_whenflagclicked'}]]
    });

    assert.equal(program.mode, 'replace');
});

test('normalizeProgram accepts a bare script or a list of scripts', () => {
    const oneScript = normalizeProgram([{opcode: 'event_whenflagclicked'}]);
    const multipleScripts = normalizeProgram([
        [{opcode: 'event_whenflagclicked'}],
        [{opcode: 'event_whenkeypressed'}]
    ]);

    assert.equal(oneScript.scripts.length, 1);
    assert.equal(multipleScripts.scripts.length, 2);
});

test('normalizeProgram rejects payloads without a scripts array', () => {
    assert.throws(
        () => normalizeProgram({blocks: []}),
        /"scripts" 配列が見つかりません/
    );
});


test('response parser recognizes an unfenced Scratch block array inside assistant text', () => {
    const response = 'りんごのプログラムです。\n[{"opcode":"event_whenflagclicked"}]\nこれで完成です。';
    const segments = splitBareJsonSegments(response);

    assert.equal(segments.length, 3);
    assert.equal(segments[0].type, 'text');
    assert.equal(segments[1].type, 'code');
    assert.equal(segments[1].lang, 'scratch-blocks');
    assert.deepEqual(JSON.parse(segments[1].content), [
        {opcode: 'event_whenflagclicked'}
    ]);
    assert.equal(segments[2].type, 'text');
});

test('response parser recognizes an unfenced scripts object', () => {
    const response = 'コード：\n{"mode":"add","scripts":[[{"opcode":"event_whenflagclicked"}]]}';
    const segments = splitBareJsonSegments(response);

    assert.equal(segments.length, 2);
    assert.equal(segments[1].lang, 'scratch-blocks');
    assert.equal(JSON.parse(segments[1].content).scripts.length, 1);
});

test('response parser leaves ordinary JSON and explanatory text untouched', () => {
    const response = '配列の例：[1, 2, 3]\nこれは通常の説明です。';
    const segments = splitBareJsonSegments(response);

    assert.equal(segments.length, 1);
    assert.equal(segments[0].type, 'text');
    assert.equal(segments[0].content, response);
});

test('response parser handles escaped quotes and braces inside JSON strings', () => {
    const response = 'JSON: {"scripts":[[{"opcode":"looks_say","inputs":{"MESSAGE":"say \\"hello\\" } safely"}}]]}';
    const segments = splitBareJsonSegments(response);

    assert.equal(segments.length, 2);
    assert.equal(segments[1].lang, 'scratch-blocks');
    assert.equal(JSON.parse(segments[1].content).scripts[0][0].inputs.MESSAGE, 'say "hello" } safely');
});
