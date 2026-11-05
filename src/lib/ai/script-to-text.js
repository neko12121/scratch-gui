/**
 * Convert the scripts of a VM target into compact, AI-readable text.
 *
 * Output example:
 *   [script 1]
 *   event_whenflagclicked
 *   control_forever
 *     SUBSTACK:
 *       motion_movesteps STEPS=(10)
 *       control_if CONDITION=<sensing_touchingobject TOUCHINGOBJECTMENU=(_edge_)>
 *         SUBSTACK:
 *           motion_turnright DEGREES=(15)
 */

const MAX_BLOCKS = 1500;

const formatValue = value => {
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
};

const isShadowLike = block => block && block.shadow;

const formatReporter = (blocks, id, depth) => {
    const block = blocks[id];
    if (!block) return '()';
    if (depth > 30) return '(...)';

    // Shadow block (number/text/menu): just show its field value
    if (isShadowLike(block)) {
        const fieldNames = Object.keys(block.fields || {});
        if (fieldNames.length > 0) {
            return `(${formatValue(block.fields[fieldNames[0]].value)})`;
        }
        return '()';
    }

    // Variables and lists show as their name
    if (block.opcode === 'data_variable' && block.fields.VARIABLE) {
        return `(variable:${block.fields.VARIABLE.value})`;
    }
    if (block.opcode === 'data_listcontents' && block.fields.LIST) {
        return `(list:${block.fields.LIST.value})`;
    }
    if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
        return `(argument:${block.fields.VALUE ? block.fields.VALUE.value : ''})`;
    }

    // eslint-disable-next-line no-use-before-define
    const args = formatArguments(blocks, block, depth + 1);
    const inner = `${block.opcode}${args.length ? ` ${args.join(' ')}` : ''}`;
    // Boolean-ish opcodes are typically wrapped in <> in Scratch notation
    return `<${inner}>`;
};

const formatArguments = (blocks, block, depth) => {
    const out = [];
    for (const name of Object.keys(block.fields || {})) {
        out.push(`${name}=[${formatValue(block.fields[name].value)}]`);
    }
    for (const name of Object.keys(block.inputs || {})) {
        if (name.startsWith('SUBSTACK') || name === 'custom_block') continue;
        const input = block.inputs[name];
        const childId = input.block || input.shadow;
        if (!childId) {
            out.push(`${name}=()`);
            continue;
        }
        out.push(`${name}=${formatReporter(blocks, childId, depth)}`);
    }
    if (block.mutation && block.mutation.proccode) {
        out.push(`proccode="${block.mutation.proccode}"`);
    }
    return out;
};

const formatStack = (blocks, startId, indent, lines, counter) => {
    let id = startId;
    while (id && counter.count < MAX_BLOCKS) {
        const block = blocks[id];
        if (!block) break;
        counter.count++;
        const pad = '  '.repeat(indent);

        let header = block.opcode;
        if (block.opcode === 'procedures_definition' && block.inputs.custom_block) {
            const proto = blocks[block.inputs.custom_block.block];
            if (proto && proto.mutation) {
                header += ` proccode="${proto.mutation.proccode}"`;
                if (proto.mutation.argumentnames) {
                    header += ` argumentnames=${proto.mutation.argumentnames}`;
                }
            }
        } else {
            const args = formatArguments(blocks, block, 0);
            if (args.length) header += ` ${args.join(' ')}`;
        }
        lines.push(pad + header);

        for (const name of Object.keys(block.inputs || {})) {
            if (!name.startsWith('SUBSTACK')) continue;
            const sub = block.inputs[name].block;
            lines.push(`${pad}  ${name}:`);
            if (sub) {
                formatStack(blocks, sub, indent + 2, lines, counter);
            } else {
                lines.push(`${pad}    (empty)`);
            }
        }
        id = block.next;
    }
};

/**
 * @param {object} target VM RenderedTarget (e.g. vm.editingTarget)
 * @returns {string} readable description of scripts
 */
const targetToText = target => {
    if (!target) return '(no sprite selected)';
    const container = target.blocks;
    const blocks = container._blocks;
    const scripts = container.getScripts ? container.getScripts() : container._scripts;
    const lines = [];
    const counter = {count: 0};

    lines.push(`Sprite: ${target.getName()}${target.isStage ? ' (Stage)' : ''}`);
    const describeVars = vars => Object.values(vars || {})
        .filter(v => v.type === '' || v.type === 'list')
        .map(v => `${v.name}${v.type === 'list' ? ' [list]' : ''}`)
        .join(', ');
    const local = describeVars(target.variables);
    if (local) lines.push(`${target.isStage ? 'Global' : 'Local (this sprite only)'} variables/lists: ${local}`);
    if (!target.isStage && target.runtime && target.runtime.getTargetForStage()) {
        const global = describeVars(target.runtime.getTargetForStage().variables);
        if (global) lines.push(`Global variables/lists: ${global}`);
    }

    const topLevel = scripts.filter(id => blocks[id] && !blocks[id].shadow);
    if (topLevel.length === 0) {
        lines.push('(no scripts yet)');
        return lines.join('\n');
    }
    topLevel.forEach((id, index) => {
        lines.push('');
        lines.push(`[script ${index + 1}]`);
        formatStack(blocks, id, 0, lines, counter);
    });
    if (counter.count >= MAX_BLOCKS) {
        lines.push('... (truncated)');
    }
    return lines.join('\n');
};

/**
 * Same as targetToText but for a single script that contains the given block.
 * @param {object} target VM target
 * @param {string} blockId any block id in the script
 * @returns {string} text
 */
const scriptToText = (target, blockId) => {
    const blocks = target.blocks._blocks;
    let id = blockId;
    // Walk up to the top block
    while (blocks[id] && blocks[id].parent) id = blocks[id].parent;
    const lines = [];
    formatStack(blocks, id, 0, lines, {count: 0});
    return lines.join('\n');
};

export {
    targetToText,
    scriptToText
};
