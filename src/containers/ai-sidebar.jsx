import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import AISidebarComponent from '../components/ai-sidebar/ai-sidebar.jsx';
import AddonHooks from '../addons/hooks.js';
import {chat, loadSettings, saveSettings} from '../lib/ai/ai-client.js';
import {targetToText} from '../lib/ai/script-to-text.js';
import {describeToolbox, insertProgram} from '../lib/ai/json-to-blocks.js';
import {buildSystemMessage} from '../lib/ai/prompts.js';
import {activateTab, BLOCKS_TAB_INDEX} from '../reducers/editor-tab';

const OPEN_KEY = 'tw:ai-sidebar:open';
const MAX_HISTORY = 16;

const resizeBlockly = () => {
    // Let flexbox settle first, then tell Blockly about the new size
    setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
};

class AISidebar extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleToggle',
            'handleToggleSettings',
            'handleChangeSettings',
            'handleChangeInput',
            'handleKeyDown',
            'handleSend',
            'handleQuickPrompt',
            'handleStop',
            'handleClear',
            'handleInsert',
            'setMessagesRef'
        ]);
        let isOpen = true;
        try {
            isOpen = localStorage.getItem(OPEN_KEY) !== 'false';
        } catch (e) {
            // ignore
        }
        this.state = {
            isOpen,
            settingsOpen: false,
            settings: loadSettings(),
            messages: [],
            input: '',
            busy: false,
            streamingText: '',
            error: '',
            notice: ''
        };
        this.abortController = null;
        this.messagesEl = null;
    }
    componentDidUpdate (prevProps, prevState) {
        if (prevState.isOpen !== this.state.isOpen) resizeBlockly();
        if (
            prevState.messages !== this.state.messages ||
            prevState.streamingText !== this.state.streamingText ||
            prevState.error !== this.state.error
        ) {
            this.scrollToBottom();
        }
    }
    componentWillUnmount () {
        if (this.abortController) this.abortController.abort();
    }
    setMessagesRef (el) {
        this.messagesEl = el;
    }
    scrollToBottom () {
        if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
    handleToggle () {
        const isOpen = !this.state.isOpen;
        try {
            localStorage.setItem(OPEN_KEY, String(isOpen));
        } catch (e) {
            // ignore
        }
        this.setState({isOpen});
    }
    handleToggleSettings () {
        this.setState({settingsOpen: !this.state.settingsOpen});
    }
    handleChangeSettings (patch) {
        const settings = Object.assign({}, this.state.settings, patch);
        saveSettings(settings);
        this.setState({settings});
    }
    handleChangeInput (e) {
        this.setState({input: e.target.value});
    }
    handleKeyDown (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            this.handleSend();
        }
    }
    handleQuickPrompt (text) {
        this.send(text);
    }
    handleSend () {
        this.send(this.state.input);
    }
    handleStop () {
        if (this.abortController) this.abortController.abort();
    }
    handleClear () {
        this.handleStop();
        this.setState({messages: [], error: '', notice: '', streamingText: ''});
    }
    buildRequestMessages (history) {
        const target = this.props.vm.editingTarget;
        const system = buildSystemMessage({
            blockCatalog: describeToolbox(this.props.toolboxXML),
            projectText: targetToText(target)
        });
        return [{role: 'system', content: system}].concat(
            history.slice(-MAX_HISTORY).map(m => ({role: m.role, content: m.content}))
        );
    }
    async send (rawText) {
        const text = (rawText || '').trim();
        if (!text || this.state.busy) return;

        const messages = this.state.messages.concat({role: 'user', content: text});
        this.setState({messages, input: '', busy: true, error: '', notice: '', streamingText: ''});

        this.abortController = new AbortController();
        try {
            const reply = await chat(this.state.settings, this.buildRequestMessages(messages), {
                signal: this.abortController.signal,
                onToken: streamingText => this.setState({streamingText})
            });
            this.setState({
                messages: messages.concat({role: 'assistant', content: reply || '(返事がありませんでした)'})
            });
        } catch (e) {
            if (e.name === 'AbortError') {
                if (this.state.streamingText) {
                    this.setState({
                        messages: messages.concat({
                            role: 'assistant',
                            content: `${this.state.streamingText}\n\n（中断しました）`
                        })
                    });
                }
            } else {
                this.setState({
                    error: `${e.message}\n「設定」でエンドポイント・APIキー・モデルを確認してください。`
                });
            }
        } finally {
            this.abortController = null;
            this.setState({busy: false, streamingText: ''});
        }
    }
    handleInsert (program, mode) {
        const ScratchBlocks = AddonHooks.blockly;
        const workspace = AddonHooks.blocklyWorkspace;
        if (!ScratchBlocks || !workspace) {
            this.setState({error: 'ブロックエディターが準備できていません。「コード」タブを開いてください。'});
            return;
        }
        if (mode === 'replace') {
            // eslint-disable-next-line no-alert
            const ok = window.confirm('このスプライトのコードを全部消して置き換えます。よろしいですか？（Ctrl+Z で元に戻せます）');
            if (!ok) return;
        }
        if (this.props.activeTabIndex !== BLOCKS_TAB_INDEX) this.props.onActivateBlocksTab();
        try {
            const result = insertProgram(
                ScratchBlocks,
                workspace,
                Object.assign({}, program, {mode}),
                this.props.toolboxXML
            );
            const warn = result.warnings.length ? `\n注意: ${result.warnings.join(' / ')}` : '';
            this.setState({
                error: '',
                notice: `${result.count} 個のスクリプトを「${this.props.vm.editingTarget.getName()}」に追加しました。` +
                    `元に戻すときは Ctrl+Z。${warn}`
            });
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            this.setState({error: `ブロックを追加できませんでした: ${e.message}`});
        }
    }
    render () {
        const target = this.props.vm.editingTarget;
        return (
            <AISidebarComponent
                busy={this.state.busy}
                error={this.state.error}
                input={this.state.input}
                isOpen={this.state.isOpen}
                messages={this.state.messages}
                notice={this.state.notice}
                setMessagesRef={this.setMessagesRef}
                settings={this.state.settings}
                settingsOpen={this.state.settingsOpen}
                streamingText={this.state.streamingText}
                targetName={target ? target.getName() : ''}
                toolboxXML={this.props.toolboxXML}
                onChangeInput={this.handleChangeInput}
                onChangeSettings={this.handleChangeSettings}
                onClear={this.handleClear}
                onInsert={this.handleInsert}
                onKeyDown={this.handleKeyDown}
                onQuickPrompt={this.handleQuickPrompt}
                onSend={this.handleSend}
                onStop={this.handleStop}
                onToggle={this.handleToggle}
                onToggleSettings={this.handleToggleSettings}
            />
        );
    }
}

AISidebar.propTypes = {
    activeTabIndex: PropTypes.number,
    onActivateBlocksTab: PropTypes.func,
    toolboxXML: PropTypes.string,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    activeTabIndex: state.scratchGui.editorTab.activeTabIndex,
    toolboxXML: state.scratchGui.toolbox.toolboxXML,
    // re-render when the selected sprite changes
    editingTarget: state.scratchGui.targets.editingTarget
});

const mapDispatchToProps = dispatch => ({
    onActivateBlocksTab: () => dispatch(activateTab(BLOCKS_TAB_INDEX))
});

export default connect(mapStateToProps, mapDispatchToProps)(AISidebar);
