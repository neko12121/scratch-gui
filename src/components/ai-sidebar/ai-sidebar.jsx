/* eslint-disable react/jsx-no-bind */
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import MessageContent from './message-content.jsx';
import {QUICK_PROMPTS} from '../../lib/ai/prompts.js';
import styles from './ai-sidebar.css';

const SettingsPanel = ({settings, onChange, onClose}) => (
    <div className={styles.settings}>
        <div className={styles.settingsTitle}>{'AI の設定'}</div>
        <label className={styles.label}>
            {'API エンドポイント（OpenAI 互換）'}
            <input
                className={styles.textInput}
                placeholder="http://localhost:8787/v1"
                value={settings.endpoint}
                onChange={e => onChange({endpoint: e.target.value})}
            />
        </label>
        <label className={styles.label}>
            {'API キー（プロキシ利用時は空でOK）'}
            <input
                autoComplete="off"
                className={styles.textInput}
                placeholder="sk-..."
                type="password"
                value={settings.apiKey}
                onChange={e => onChange({apiKey: e.target.value})}
            />
        </label>
        <label className={styles.label}>
            {'モデル'}
            <input
                className={styles.textInput}
                placeholder="gpt-4o-mini"
                value={settings.model}
                onChange={e => onChange({model: e.target.value})}
            />
        </label>
        <div className={styles.hint}>
            {'キーはこのブラウザの localStorage にだけ保存されます。公開サイトでは ai-proxy を使い、キーをサーバー側に置いてください。'}
        </div>
        <button
            className={styles.primaryButton}
            onClick={onClose}
        >
            {'閉じる'}
        </button>
    </div>
);

SettingsPanel.propTypes = {
    onChange: PropTypes.func,
    onClose: PropTypes.func,
    settings: PropTypes.shape({
        apiKey: PropTypes.string,
        endpoint: PropTypes.string,
        model: PropTypes.string
    })
};

const AISidebarComponent = props => {
    const {
        busy,
        error,
        input,
        isOpen,
        messages,
        notice,
        settings,
        settingsOpen,
        streamingText,
        targetName,
        toolboxXML,
        onChangeInput,
        onChangeSettings,
        onClear,
        onInsert,
        onOpenSpriteLibrary,
        onAddCostume,
        onApplyProject,
        onKeyDown,
        onQuickPrompt,
        onSend,
        onStop,
        onToggle,
        onToggleSettings,
        setMessagesRef
    } = props;

    if (!isOpen) {
        return (
            <button
                className={styles.collapsedTab}
                title="AI先生をひらく"
                onClick={onToggle}
            >
                <span className={styles.collapsedIcon}>{'AI'}</span>
                <span className={styles.collapsedLabel}>{'AI先生'}</span>
            </button>
        );
    }

    return (
        <div className={styles.sidebarOuter}>
            <div className={styles.sidebar}>
                <div className={styles.header}>
                    <div className={styles.title}>
                        <span className={styles.badge}>{'AI'}</span>
                        {'AI先生'}
                    </div>
                    <div className={styles.headerButtons}>
                        <button
                            className={styles.iconButton}
                            title="会話をリセット"
                            onClick={onClear}
                        >{'リセット'}</button>
                        <button
                            className={styles.iconButton}
                            title="設定"
                            onClick={onToggleSettings}
                        >{'設定'}</button>
                        <button
                            className={styles.iconButton}
                            title="閉じる"
                            onClick={onToggle}
                        >{'×'}</button>
                    </div>
                </div>

                {settingsOpen ? (
                    <SettingsPanel
                        settings={settings}
                        onChange={onChangeSettings}
                        onClose={onToggleSettings}
                    />
                ) : null}

                <div className={styles.context}>
                    {`見ているスプライト: ${targetName || '-'}`}
                </div>

                <div
                    className={styles.messages}
                    ref={setMessagesRef}
                >
                    {messages.length === 0 && !busy ? (
                        <div className={styles.welcome}>
                            <div className={styles.welcomeTitle}>{'こんにちは！ AI先生です。'}</div>
                            <div>{'プログラミングでわからないことを聞いてね。「〜を作って」と頼むと、ブロックを作ってエディターに追加できるよ。'}</div>
                        </div>
                    ) : null}
                    {messages.map((m, i) => (
                        <div
                            className={classNames(styles.message, m.role === 'user' ? styles.user : styles.assistant)}
                            key={i}
                        >
                            {m.role === 'user' ? (
                                <div className={styles.text}>{m.content}</div>
                            ) : (
                                <MessageContent
                                    text={m.content}
                                    toolboxXML={toolboxXML}
                                    onInsert={onInsert}
                                    onAddCostume={onAddCostume}
                                    onApplyProject={onApplyProject}
                                />
                            )}
                        </div>
                    ))}
                    {busy ? (
                        <div className={classNames(styles.message, styles.assistant)}>
                            {streamingText ? (
                                <MessageContent
                                    streaming
                                    text={streamingText}
                                    toolboxXML={toolboxXML}
                                    onInsert={onInsert}
                                    onAddCostume={onAddCostume}
                                    onApplyProject={onApplyProject}
                                />
                            ) : (
                                <div className={styles.thinking}>{'考えています…'}</div>
                            )}
                        </div>
                    ) : null}
                    {error ? <div className={styles.error}>{error}</div> : null}
                    {notice ? <div className={styles.notice}>{notice}</div> : null}
                </div>

                <div className={styles.quickPrompts}>
                    <button
                        className={styles.chip}
                        disabled={busy}
                        onClick={() => onQuickPrompt('今選択しているスプライト用に、見た目やポーズが異なる3つのコスチュームを作ってください。回答は scratch-project-json のコードフェンスで、costumes 配列に name と svg を3個入れ、sprites/backdrops/scripts は空配列にしてください。SVGは自己完結した安全な図形だけを使ってください。')}
                    >{'複数コスチューム生成'}</button>
                    <button
                        className={styles.chip}
                        disabled={busy}
                        onClick={() => onQuickPrompt('Scratchのステージに使うオリジナル背景を1〜2個作ってください。回答は scratch-project-json のコードフェンスで、backdrops 配列に name と svg を入れ、costumes/sprites/scripts は空配列にしてください。ステージ全体を覆う横長の風景にしてください。')}
                    >{'背景を自動生成'}</button>
                    <button
                        className={styles.chip}
                        disabled={busy}
                        onClick={() => onQuickPrompt('簡単なゲームを作るため、素材とブロックを一括生成してください。回答は scratch-project-json のコードフェンス1つだけにしてください。costumesには現在選択中のスプライト用素材、spritesには追加で必要なスプライトと各2個程度のcostumes、backdropsには背景を1個、scriptsには現在選択中のスプライトに追加する動作ブロックを入れてください。scriptsのopcode/inputs/fieldsは使えるブロック一覧に完全に従い、変数が必要なら最小限にしてください。')}
                    >{'ゲームを一括生成'}</button>
                    <button
                        className={styles.chip}
                        disabled={busy}
                        onClick={onOpenSpriteLibrary}
                    >{'Scratchの素材を追加'}</button>
                    {QUICK_PROMPTS.map(p => (
                        <button
                            className={styles.chip}
                            disabled={busy}
                            key={p.label}
                            onClick={() => onQuickPrompt(p.text)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                <div className={styles.inputRow}>
                    <textarea
                        className={styles.textarea}
                        placeholder="質問してみよう（Enterで送信、Shift+Enterで改行）"
                        rows={3}
                        value={input}
                        onChange={onChangeInput}
                        onKeyDown={onKeyDown}
                    />
                    {busy ? (
                        <button
                            className={styles.secondaryButton}
                            onClick={onStop}
                        >{'止める'}</button>
                    ) : (
                        <button
                            className={styles.primaryButton}
                            disabled={!input.trim()}
                            onClick={onSend}
                        >{'送信'}</button>
                    )}
                </div>
            </div>
        </div>
    );
};

AISidebarComponent.propTypes = {
    busy: PropTypes.bool,
    error: PropTypes.string,
    input: PropTypes.string,
    isOpen: PropTypes.bool,
    messages: PropTypes.arrayOf(PropTypes.shape({
        role: PropTypes.string,
        content: PropTypes.string
    })),
    notice: PropTypes.string,
    onChangeInput: PropTypes.func,
    onChangeSettings: PropTypes.func,
    onClear: PropTypes.func,
    onInsert: PropTypes.func,
    onOpenSpriteLibrary: PropTypes.func,
    onAddCostume: PropTypes.func,
    onApplyProject: PropTypes.func,
    onKeyDown: PropTypes.func,
    onQuickPrompt: PropTypes.func,
    onSend: PropTypes.func,
    onStop: PropTypes.func,
    onToggle: PropTypes.func,
    onToggleSettings: PropTypes.func,
    setMessagesRef: PropTypes.func,
    settings: PropTypes.object, // eslint-disable-line react/forbid-prop-types
    settingsOpen: PropTypes.bool,
    streamingText: PropTypes.string,
    targetName: PropTypes.string,
    toolboxXML: PropTypes.string
};

export default AISidebarComponent;
