/**
 * Turn the simple JSON format the AI produces into scratch-blocks XML and
 * insert it into the Blockly workspace.
 *
 * Format (inside a ```scratch-blocks fenced code block):
 * {
 *   "mode": "add" | "replace",          // optional, default "add"
 *   "scripts": [
 *     [
 *       {"opcode": "event_whenflagclicked"},
 *       {"opcode": "control_forever", "inputs": {
 *         "SUBSTACK": [
 *           {"opcode": "motion_movesteps", "inputs": {"STEPS": 10}},
 *           {"opcode": "motion_ifonedgebounce"}
 *         ]
 *       }},
 *     ]
 *   ]
 * }
 *
 * - primitive input value -> sets the shadow's field (number/text/menu)
 * - object input value    -> nested reporter/boolean block
 * - array input value     -> statement stack (SUBSTACK, SUBSTACK2)
 * - "fields"              -> dropdown fields / variable names
 *
 * Shadows (default number/text/menu inputs) are copied from the toolbox XML,
 * so the AI does not need to know the shadow block types.
 */

const STATEMENT_INPUT = /^SUBSTACK\d*$/;

// Shadow types whose field name differs from the input name
const SHADOW_FIELD_NAMES = {
    colour_picker: 'COLOUR',
    math_number: 'NUM',
    math_positive_number: 'NUM',
    math_whole_number: 'NUM',
    math_integer: 'NUM',
    math_angle: 'NUM',
    text: 'TEXT'
};

// Variable/list blocks are generated dynamically by scratch-blocks and are not
// part of the toolbox XML, so we provide templates for them here.
/* eslint-disable max-len */
const num = (name, v) => [
    `<value name="${name}"><shadow type="math_number">`,
    `<field name="NUM">${v}</field></shadow></value>`
].join('');
const int = (name, v) => [
    `<value name="${name}"><shadow type="math_integer">`,
    `<field name="NUM">${v}</field></shadow></value>`
].join('');
const txt = (name, v) => `<value name="${name}"><shadow type="text"><field name="TEXT">${v}</field></shadow></value>`;
const VAR = '<field name="VARIABLE" variabletype="">my variable</field>';
const LIST = '<field name="LIST" variabletype="list">my list</field>';
const BROADCAST = '<field name="BROADCAST_OPTION" variabletype="broadcast_msg">message1</field>';
/* eslint-enable max-len */
const FALLBACK_TEMPLATES = `<xml><category>
<block type="event_broadcast">${BROADCAST}</block>
<block type="event_broadcastandwait">${BROADCAST}</block>
<block type="event_whenbroadcastreceived">${BROADCAST}</block>
<block type="data_variable">${VAR}</block>
<block type="data_setvariableto">${VAR}${txt('VALUE', '0')}</block>
<block type="data_changevariableby">${VAR}${num('VALUE', '1')}</block>
<block type="data_showvariable">${VAR}</block>
<block type="data_hidevariable">${VAR}</block>
<block type="data_listcontents">${LIST}</block>
<block type="data_addtolist">${LIST}${txt('ITEM', 'thing')}</block>
<block type="data_deleteoflist">${LIST}${int('INDEX', '1')}</block>
<block type="data_deletealloflist">${LIST}</block>
<block type="data_insertatlist">${LIST}${txt('ITEM', 'thing')}${int('INDEX', '1')}</block>
<block type="data_replaceitemoflist">${LIST}${int('INDEX', '1')}${txt('ITEM', 'thing')}</block>
<block type="data_itemoflist">${LIST}${int('INDEX', '1')}</block>
<block type="data_itemnumoflist">${LIST}${txt('ITEM', 'thing')}</block>
<block type="data_lengthoflist">${LIST}</block>
<block type="data_listcontainsitem">${LIST}${txt('ITEM', 'thing')}</block>
<block type="data_showlist">${LIST}</block>
<block type="data_hidelist">${LIST}</block>
</category></xml>`;

let cachedToolboxXML = null;
let cachedTemplates = null;

const parseToolbox = toolboxXML => {
    if (toolboxXML === cachedToolboxXML && cachedTemplates) return cachedTemplates;
    const templates = {};
    const collect = xmlText => {
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const blockEls = doc.getElementsByTagName('block');
        for (let i = 0; i < blockEls.length; i++) {
            const el = blockEls[i];
            // Only top-level toolbox entries (direct children of <category>)
            if (el.parentNode && el.parentNode.nodeName !== 'category') continue;
            const type = el.getAttribute('type');
            if (type && !templates[type]) templates[type] = el;
        }
    };
    try {
        collect(toolboxXML || '<xml></xml>');
        collect(FALLBACK_TEMPLATES);
    } catch (e) {
        // ignore, we'll just have no templates
    }
    cachedToolboxXML = toolboxXML;
    cachedTemplates = templates;
    return templates;
};

/**
 * Compact catalog of blocks available in the current toolbox, for the AI prompt.
 * @param {string} toolboxXML toolbox XML
 * @returns {string} one line per opcode
 */
const describeToolbox = toolboxXML => {
    const templates = parseToolbox(toolboxXML);
    return Object.keys(templates).map(type => {
        const el = templates[type];
        const parts = [];
        for (const child of Array.from(el.children)) {
            const name = child.getAttribute('name');
            if (child.nodeName === 'value') {
                const source = Array.from(child.children)
                    .find(c => c.nodeName === 'shadow' || c.nodeName === 'block');
                if (!source) {
                    parts.push(`${name}:value`);
                    continue;
                }
                const sourceType = source.getAttribute('type') || 'block';
                const defaults = Array.from(source.children)
                    .filter(c => c.nodeName === 'field')
                    .map(field => `${field.getAttribute('name')}=${JSON.stringify(field.textContent)}`);
                parts.push(`${name}:value<${sourceType}${defaults.length ? ` ${defaults.join(' ')}` : ''}>`);
            } else if (child.nodeName === 'field') {
                parts.push(`field ${name}=${JSON.stringify(child.textContent)}`);
            } else if (child.nodeName === 'statement') {
                parts.push(`${name}:stack`);
            }
        }
        return parts.length ? `${type}(${parts.join(', ')})` : type;
    })
        .join('\n');
};

const createEl = (doc, name) => doc.createElement(name);

const setFieldText = (fieldEl, value) => {
    fieldEl.textContent = String(value);
    // Variable fields: drop the id so Blockly looks the variable up by name
    if (fieldEl.hasAttribute('id')) fieldEl.removeAttribute('id');
};

// eslint-disable-next-line no-use-before-define
const buildStack = (doc, templates, list, warnings) => {
    let first = null;
    let previous = null;
    for (const spec of list) {
        // eslint-disable-next-line no-use-before-define
        const el = buildBlock(doc, templates, spec, warnings);
        if (!el) continue;
        if (first) {
            const next = createEl(doc, 'next');
            next.appendChild(el);
            previous.appendChild(next);
        } else {
            first = el;
        }
        previous = el;
    }
    return first;
};

const buildBlock = (doc, templates, spec, warnings) => {
    if (!spec || typeof spec !== 'object' || typeof spec.opcode !== 'string') {
        warnings.push(`不正なブロック指定をスキップしました: ${JSON.stringify(spec)}`);
        return null;
    }
    const template = templates[spec.opcode];
    if (!template) {
        warnings.push(`「${spec.opcode}」は現在のツールボックスにありません。ブロックをスキップしました。`);
        return null;
    }

    const el = doc.importNode(template, true);
    el.removeAttribute('id');
    el.removeAttribute('x');
    el.removeAttribute('y');

    const findChild = (tag, name) => Array.from(el.children)
        .find(c => c.nodeName === tag && c.getAttribute('name') === name);

    // Only accept fields that actually exist on this toolbox block.
    const fields = spec.fields || {};
    if (typeof fields !== 'object' || Array.isArray(fields)) {
        warnings.push(`「${spec.opcode}」の fields はオブジェクトではありません。`);
    } else {
        for (const name of Object.keys(fields)) {
            const fieldEl = findChild('field', name);
            if (!fieldEl) {
                warnings.push(`「${spec.opcode}」に field「${name}」はありません。無視しました。`);
                continue;
            }
            setFieldText(fieldEl, fields[name]);
        }
    }

    // Only accept value/statement inputs that are present in the real block template.
    const inputs = spec.inputs || {};
    if (typeof inputs !== 'object' || Array.isArray(inputs)) {
        warnings.push(`「${spec.opcode}」の inputs はオブジェクトではありません。`);
        return el;
    }
    for (const name of Object.keys(inputs)) {
        const value = inputs[name];
        if (STATEMENT_INPUT.test(name)) {
            let stmt = findChild('statement', name);
            if (!stmt) {
                warnings.push(`「${spec.opcode}」に stack 入力「${name}」はありません。無視しました。`);
                continue;
            }
            const stackList = Array.isArray(value) ? value : [value];
            el.removeChild(stmt);
            stmt = createEl(doc, 'statement');
            stmt.setAttribute('name', name);
            const stack = buildStack(doc, templates, stackList, warnings);
            if (stack) stmt.appendChild(stack);
            el.appendChild(stmt);
            continue;
        }

        if (Array.isArray(value)) {
            warnings.push(`「${spec.opcode}」の value 入力「${name}」に配列は使えません。無視しました。`);
            continue;
        }
        const valueEl = findChild('value', name);
        if (!valueEl) {
            warnings.push(`「${spec.opcode}」に value 入力「${name}」はありません。無視しました。`);
            continue;
        }

        if (value !== null && typeof value === 'object') {
            for (const child of Array.from(valueEl.children)) {
                if (child.nodeName === 'block') valueEl.removeChild(child);
            }
            const child = buildBlock(doc, templates, value, warnings);
            if (child) valueEl.appendChild(child);
        } else {
            const shadow = Array.from(valueEl.children).find(c => c.nodeName === 'shadow');
            if (shadow) {
                let field = Array.from(shadow.children).find(c => c.nodeName === 'field');
                if (!field) {
                    field = createEl(doc, 'field');
                    const shadowType = shadow.getAttribute('type');
                    field.setAttribute('name', SHADOW_FIELD_NAMES[shadowType] || name);
                    shadow.appendChild(field);
                }
                setFieldText(field, value);
            } else {
                warnings.push(`「${spec.opcode}」の入力「${name}」はブロックを必要とします。数値・文字列ではなく opcode オブジェクトを指定してください。`);
            }
        }
    }
    return el;
};

/**
 * Parse the AI JSON (string or object) into a normalized object.
 * @param {string|object} json input
 * @returns {{mode: string, scripts: Array}} normalized
 */
const normalizeProgram = json => {
    let data = json;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Array.isArray(data)) {
        // Allow a bare script or list of scripts
        data = {scripts: Array.isArray(data[0]) ? data : [data]};
    }
    if (!data || !Array.isArray(data.scripts)) {
        throw new Error('"scripts" 配列が見つかりません');
    }
    return {
        mode: data.mode === 'replace' ? 'replace' : 'add',
        scripts: data.scripts.map(s => (Array.isArray(s) ? s : [s]))
    };
};

/**
 * Convert to scripts XML string.
 * @param {object} program normalized program
 * @param {string} toolboxXML current toolbox XML
 * @returns {{xml: string, warnings: string[]}} result
 */
const programToXML = (program, toolboxXML) => {
    const templates = parseToolbox(toolboxXML);
    const doc = document.implementation.createDocument(null, 'xml', null);
    const root = doc.documentElement;
    const warnings = [];
    for (const script of program.scripts) {
        const top = buildStack(doc, templates, script, warnings);
        if (top) root.appendChild(top);
    }
    return {
        xml: new XMLSerializer().serializeToString(doc),
        warnings
    };
};

/**
 * Insert the program into the Blockly workspace. Undo (Ctrl+Z) reverts it in one step.
 * @param {object} ScratchBlocks scratch-blocks module
 * @param {object} workspace Blockly workspace
 * @param {object} program normalized program
 * @param {string} toolboxXML toolbox XML
 * @returns {{count: number, warnings: string[]}} result
 */
const insertProgram = (ScratchBlocks, workspace, program, toolboxXML) => {
    const {xml, warnings} = programToXML(program, toolboxXML);
    if (warnings.length) {
        throw new Error(`ブロックJSONに不整合があります。追加前に修正してください:\n${warnings.join('\n')}`);
    }
    const dom = ScratchBlocks.Xml.textToDom(xml);

    ScratchBlocks.Events.setGroup(true);
    let count = 0;
    try {
        if (program.mode === 'replace') {
            workspace.getTopBlocks(false).forEach(b => b.dispose(false));
        }

        // Place new scripts below existing ones
        let y = 40;
        const metrics = workspace.getBlocksBoundingBox ? workspace.getBlocksBoundingBox() : null;
        if (metrics && workspace.getTopBlocks(false).length > 0) {
            y = metrics.y + metrics.height + 60;
        }
        const x = 40;

        for (const top of Array.from(dom.children)) {
            const block = ScratchBlocks.Xml.domToBlock(top, workspace);
            block.moveBy(x, y);
            const size = block.getHeightWidth ? block.getHeightWidth() : {height: 100};
            y += size.height + 48;
            count++;
        }
    } finally {
        ScratchBlocks.Events.setGroup(false);
    }
    return {count, warnings};
};

export {
    describeToolbox,
    normalizeProgram,
    programToXML,
    insertProgram
};
