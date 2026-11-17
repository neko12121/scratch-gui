import {test} from 'node:test';
import assert from 'node:assert/strict';

import {buildSystemMessage} from '../src/lib/ai/prompts.js';
import {
    FALLBACK_TEMPLATES,
    mergeTemplateChildren,
    normalizeProgram
} from '../src/lib/ai/json-to-blocks.js';
import {splitBareJsonSegments} from '../src/lib/ai/response-parser.js';

const makeXmlNode = (nodeName, attributes = {}, children = []) => {
    const node = {
        nodeName,
        attributes,
        children: [],
        ownerDocument: null,
        getAttribute (name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name) ?
                this.attributes[name] : null;
        },
        appendChild (child) {
            this.children.push(child);
            return child;
        },
        cloneNode (deep) {
            const clones = deep ? this.children.map(child => child.cloneNode(true)) : [];
            return makeXmlNode(this.nodeName, {...this.attributes}, clones);
        }
    };
    node.ownerDocument = {
        importNode (source, deep) {
            return source.cloneNode(deep);
        }
    };
    children.forEach(child => node.appendChild(child));
    return node;
};

test('AI prompt requires the supported Scratch block JSON format', () => {
    const message = buildSystemMessage({
        blockCatalog: 'motion_movesteps(STEPS:value<math_number NUM="10">)',
        projectText: '[script 1] event_whenflagclicked'
    });

    assert.match(message, /```scratch-blocks/);
    assert.match(message, /scratch-project-json/);
    assert.match(message, /backdrops/);
    assert.match(message, /costumes/);
    assert.match(message, /opcode、入力名、フィールド名/);
    assert.match(message, /使えるブロック一覧/);
    assert.match(message, /数値入力の例/);
    assert.match(message, /shadow\/value オブジェクトを作らない/);
    assert.ok(message.includes('motion_movesteps(STEPS:value<math_number NUM="10">)'));
    assert.ok(message.includes('[script 1] event_whenflagclicked'));
});

test('fallback templates cover if blocks and costume menu reporters', () => {
    assert.ok(FALLBACK_TEMPLATES.includes('<block type="control_if">'));
    assert.ok(FALLBACK_TEMPLATES.includes('<value name="CONDITION"></value>'));
    assert.ok(FALLBACK_TEMPLATES.includes('<statement name="SUBSTACK"></statement>'));
    assert.ok(FALLBACK_TEMPLATES.includes(
        '<block type="looks_costume"><field name="COSTUME">COSTUME1</field></block>'
    ));
});
test('toolbox templates merge missing stack, value, and field definitions', () => {
    const forever = makeXmlNode('block', {type: 'control_forever'});
    const foreverFallback = makeXmlNode('block', {type: 'control_forever'}, [
        makeXmlNode('statement', {name: 'SUBSTACK'})
    ]);
    mergeTemplateChildren(forever, foreverFallback);
    assert.equal(forever.children[0].nodeName, 'statement');
    assert.equal(forever.children[0].getAttribute('name'), 'SUBSTACK');

    const backdrop = makeXmlNode('block', {type: 'looks_switchbackdropto'}, [
        makeXmlNode('value', {name: 'BACKDROP'}, [
            makeXmlNode('shadow', {type: 'looks_backdrops'})
        ])
    ]);
    const backdropFallback = makeXmlNode('block', {type: 'looks_switchbackdropto'}, [
        makeXmlNode('value', {name: 'BACKDROP'}, [
            makeXmlNode('shadow', {type: 'looks_backdrops'}, [
                makeXmlNode('field', {name: 'BACKDROP'})
            ])
        ])
    ]);
    mergeTemplateChildren(backdrop, backdropFallback);
    assert.equal(backdrop.children.length, 1);
    assert.equal(backdrop.children[0].children.length, 1);
    assert.equal(backdrop.children[0].children[0].children[0].getAttribute('name'), 'BACKDROP');

    const broadcast = makeXmlNode('block', {type: 'event_whenbroadcastreceived'});
    const broadcastFallback = makeXmlNode('block', {type: 'event_whenbroadcastreceived'}, [
        makeXmlNode('field', {name: 'BROADCAST_OPTION', variabletype: 'broadcast_msg'})
    ]);
    mergeTemplateChildren(broadcast, broadcastFallback);
    assert.equal(broadcast.children[0].getAttribute('name'), 'BROADCAST_OPTION');
    assert.equal(broadcast.children[0].getAttribute('variabletype'), 'broadcast_msg');
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


test('response parser recognizes an unfenced combined project JSON payload', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ff0000"/></svg>';
    const response = '生成した素材：\\n' + JSON.stringify({
        costumes: [{name: '正面', svg: svg}],
        sprites: [],
        backdrops: [],
        scripts: [[{opcode: 'event_whenflagclicked'}]]
    });
    const segments = splitBareJsonSegments(response);
    assert.equal(segments.length, 2);
    assert.equal(segments[1].lang, 'scratch-project-json');
});

test('response parser keeps block-only JSON in the Scratch blocks format', () => {
    const response = 'コード：\\n{"scripts":[[{"opcode":"event_whenflagclicked"}]]}';
    const segments = splitBareJsonSegments(response);
    assert.equal(segments[1].lang, 'scratch-blocks');
});
