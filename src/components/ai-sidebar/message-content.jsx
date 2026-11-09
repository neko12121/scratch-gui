/* eslint-disable react/jsx-no-bind */
import PropTypes from 'prop-types';
import React from 'react';

import BlockPreview from './block-preview.jsx';
import {normalizeProgram, programToXML} from '../../lib/ai/json-to-blocks.js';
import {splitBareJsonSegments} from '../../lib/ai/response-parser.js';
import {normalizeProjectSpec} from '../../lib/ai/project-spec.js';
import styles from './ai-sidebar.css';

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;

// Split assistant text into text and code segments.
const splitSegments = text => {
    const segments = [];
    let last = 0;
    let match;
    FENCE.lastIndex = 0;
    while ((match = FENCE.exec(text)) !== null) {
        if (match.index > last) {
            segments.push(...splitBareJsonSegments(text.slice(last, match.index)));
        }
        segments.push({type: 'code', lang: match[1], content: match[2]});
        last = FENCE.lastIndex;
    }
    if (last < text.length) {
        segments.push(...splitBareJsonSegments(text.slice(last)));
    }
    if (segments.length === 0) {
        segments.push({type: 'text', content: text});
    }
    return segments;
};

// Very small inline markdown: **bold**, `code`
const renderInline = (line, keyPrefix) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
        const key = `${keyPrefix}-${i}`;
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            return <code key={key}>{part.slice(1, -1)}</code>;
        }
        return <React.Fragment key={key}>{part}</React.Fragment>;
    });
};

const renderText = (text, key) => {
    const lines = text.replace(/^\n+|\n+$/g, '').split('\n');
    return (
        <div
            className={styles.text}
            key={key}
        >
            {lines.map((line, i) => {
                const heading = /^#{1,4}\s+(.*)$/.exec(line);
                if (heading) {
                    return (
                        <div
                            className={styles.heading}
                            key={i}
                        >{renderInline(heading[1], i)}</div>
                    );
                }
                const bullet = /^\s*(?:[-*・]|\d+\.)\s+(.*)$/.exec(line);
                if (bullet) {
                    return (
                        <div
                            className={styles.bullet}
                            key={i}
                        >{'• '}{renderInline(bullet[1], i)}</div>
                    );
                }
                return <div key={i}>{line ? renderInline(line, i) : '\u00a0'}</div>;
            })}
        </div>
    );
};

const describeProgram = program => {
    const lines = [];
    const walk = (list, depth) => {
        for (const b of list) {
            if (!b || !b.opcode) continue;
            const args = Object.keys(b.inputs || {})
                .filter(k => !Array.isArray(b.inputs[k]))
                .map(k => {
                    const v = b.inputs[k];
                    return `${k}=${v && typeof v === 'object' ? v.opcode : v}`;
                })
                .concat(Object.keys(b.fields || {}).map(k => `${k}=${b.fields[k]}`));
            lines.push(`${'  '.repeat(depth)}${b.opcode}${args.length ? ` (${args.join(', ')})` : ''}`);
            for (const k of Object.keys(b.inputs || {})) {
                if (Array.isArray(b.inputs[k])) walk(b.inputs[k], depth + 1);
            }
        }
    };
    program.scripts.forEach((s, i) => {
        if (i) lines.push('');
        walk(s, 0);
    });
    return lines.join('\n');
};

const ProjectSegment = ({content, onApplyProject}) => {
    let project;
    try {
        project = normalizeProjectSpec(content);
    } catch (e) {
        return (
            <div className={styles.codeError}>
                {`プロジェクトJSONを読み込めません: ${e.message}`}
                <pre className={styles.code}>{content}</pre>
            </div>
        );
    }
    const costumeCount = project.costumes.length;
    const spriteCostumeCount = project.sprites.reduce((sum, sprite) =>
        sum + sprite.costumes.length, 0);
    const scriptCount = project.scripts.length;
    return (
        <div className={styles.blocksCard}>
            <div className={styles.text}>
                {'生成内容'}
                <div>{`現在のスプライトのコスチューム: ${costumeCount}個`}</div>
                <div>{`新しいスプライト: ${project.sprites.length}個（コスチューム合計 ${spriteCostumeCount}個）`}</div>
                <div>{`ステージ背景: ${project.backdrops.length}個`}</div>
                <div>{`ブロックスクリプト: ${scriptCount}個`}</div>
            </div>
            <div className={styles.blocksActions}>
                <button className={styles.primaryButton} onClick={() => onApplyProject(project)}>
                    {'素材とブロックを追加'}
                </button>
            </div>
        </div>
    );
};

const CostumeSegment = ({content, onAddCostume}) => {
    let data;
    try {
        data = JSON.parse(content);
        if (!data || typeof data.svg !== 'string' || typeof data.name !== 'string') {
            throw new Error('name と svg が必要です');
        }
    } catch (e) {
        return <div className={styles.codeError}>{`コスチュームJSONを読み込めません: ${e.message}`}</div>;
    }
    return (
        <div className={styles.blocksCard}>
            <div className={styles.text}>{`生成コスチューム: ${data.name}`}</div>
            <div className={styles.blocksActions}>
                <button className={styles.primaryButton} onClick={() => onAddCostume(data.svg, data.name)}>
                    {'このスプライトに追加'}
                </button>
            </div>
        </div>
    );
};

const BlocksSegment = ({content, toolboxXML, onInsert, streaming}) => {
    if (streaming) {
        return <div className={styles.codeNote}>{'ブロックを作っています…'}</div>;
    }
    let program;
    let xml;
    try {
        program = normalizeProgram(content);
        xml = programToXML(program, toolboxXML).xml;
    } catch (e) {
        return (
            <div className={styles.codeError}>
                {`ブロックの読み込みに失敗しました: ${e.message}`}
                <pre className={styles.code}>{content}</pre>
            </div>
        );
    }
    return (
        <div className={styles.blocksCard}>
            <BlockPreview
                fallbackText={describeProgram(program)}
                xml={xml}
            />
            <div className={styles.blocksActions}>
                <button
                    className={styles.primaryButton}
                    onClick={() => onInsert(program, 'add')}
                >
                    {'エディターに追加'}
                </button>
                <button
                    className={styles.secondaryButton}
                    title="今のスプライトのコードを全部消して、このコードに置き換えます"
                    onClick={() => onInsert(program, 'replace')}
                >
                    {'置き換え'}
                </button>
            </div>
        </div>
    );
};

BlocksSegment.propTypes = {
    content: PropTypes.string,
    onInsert: PropTypes.func,
    streaming: PropTypes.bool,
    toolboxXML: PropTypes.string
};

const MessageContent = ({text, toolboxXML, onInsert, onAddCostume, onApplyProject, streaming}) => {
    // While streaming, hide an unfinished scratch-blocks fence
    let displayText = text;
    let pendingBlocks = false;
    if (streaming) {
        const openBlocks = text.lastIndexOf('```scratch-blocks');
        const openCostume = text.lastIndexOf('```scratch-costume-json');
        const openProject = text.lastIndexOf('```scratch-project-json');
        const open = Math.max(openBlocks, openCostume, openProject);
        if (open !== -1 && text.indexOf('```', open + 3) === -1) {
            displayText = text.slice(0, open);
            pendingBlocks = true;
        }
    }
    const segments = splitSegments(displayText);
    return (
        <div>
            {segments.map((seg, i) => {
                if (seg.type === 'text') return renderText(seg.content, i);
                if (seg.lang === 'scratch-project-json') {
                    return <ProjectSegment content={seg.content} key={i} onApplyProject={onApplyProject} />;
                }
                if (seg.lang === 'scratch-costume-json') {
                    return <CostumeSegment content={seg.content} key={i} onAddCostume={onAddCostume} />;
                }
                if (seg.lang === 'scratch-blocks' || seg.lang === 'json-scratch') {
                    return (
                        <BlocksSegment
                            content={seg.content}
                            key={i}
                            toolboxXML={toolboxXML}
                            onInsert={onInsert}
                        />
                    );
                }
                return (
                    <pre
                        className={styles.code}
                        key={i}
                    >{seg.content}</pre>
                );
            })}
            {pendingBlocks ? <BlocksSegment streaming /> : null}
        </div>
    );
};

MessageContent.propTypes = {
    onInsert: PropTypes.func,
    onAddCostume: PropTypes.func,
    onApplyProject: PropTypes.func,
    streaming: PropTypes.bool,
    text: PropTypes.string,
    toolboxXML: PropTypes.string
};

export default MessageContent;
