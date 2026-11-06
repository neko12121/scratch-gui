import {test} from 'node:test';
import assert from 'node:assert/strict';

import {buildSystemMessage} from '../src/lib/ai/prompts.js';
import {normalizeProgram} from '../src/lib/ai/json-to-blocks.js';

test('AI prompt requires the supported Scratch block JSON format', () => {
    const message = buildSystemMessage({
        blockCatalog: 'motion_movesteps(STEPS:value<math_number NUM="10">)',
        projectText: '[script 1] event_whenflagclicked'
    });

    assert.match(message, /```scratch-blocks/);
    assert.match(message, /opcode、入力名、フィールド名/);
    assert.match(message, /使えるブロック一覧/);
    assert.ok(message.includes('motion_movesteps(STEPS:value<math_number NUM="10">)'));
    assert.match(message, '[script 1] event_whenflagclicked');
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
