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
import {costumeUpload} from '../lib/file-uploader.js';
import {normalizeProjectSpec, validateSvg} from '../lib/ai/project-spec.js';
import {activateTab, BLOCKS_TAB_INDEX} from '../reducers/editor-tab';
import {openSpriteLibrary} from '../reducers/modals';

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
            'handleOpenSpriteLibrary',
            'handleAddCostume',
            'handleApplyProject',
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
        this.applyingProject = false;
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
    handleOpenSpriteLibrary () {
        this.props.onOpenSpriteLibrary();
    }
    createCostumeAsset (svg, name) {
        const vm = this.props.vm;
        validateSvg(svg);
        const bytes = new TextEncoder().encode(svg);
        return new Promise((resolve, reject) => {
            costumeUpload(bytes, 'image/svg+xml', vm, costumes => {
                if (!Array.isArray(costumes) || !costumes[0]) {
                    reject(new Error('SVGからコスチュームを作成できませんでした。'));
                    return;
                }
                const costume = costumes[0];
                costume.name = (name || 'AI costume').slice(0, 80);
                resolve(costume);
            }, error => reject(error instanceof Error ? error : new Error(String(error))));
        });
    }
    async handleAddCostume (svg, name) {
        try {
            const target = this.props.vm.editingTarget;
            if (!target || target.isStage) {
                throw new Error('スプライトを選択してから追加してください。');
            }
            const costume = await this.createCostumeAsset(svg, name);
            await Promise.resolve(this.props.vm.addCostume(costume.md5, costume, target.id));
            this.setState({
                error: '',
                notice: `コスチューム「${costume.name}」を追加しました。`
            });
        } catch (e) {
            this.setState({error: `コスチュームを追加できませんでした: ${e.message}`});
        }
    }
    async handleApplyProject (input) {
        if (this.applyingProject) return;
        this.applyingProject = true;
        const vm = this.props.vm;
        const counts = {costumes: 0, spriteCostumes: 0, sprites: 0, backdrops: 0, scripts: 0};
        const warnings = [];
        try {
            const project = normalizeProjectSpec(input);
            const activeTarget = vm.editingTarget;
            const initialTargetId = activeTarget ? activeTarget.id : null;
            const spriteScriptCount = project.sprites.reduce((sum, sprite) =>
                sum + sprite.scripts.length, 0);
            const hasScripts = project.scripts.length > 0 || spriteScriptCount > 0;
            if ((project.costumes.length || project.scripts.length) &&
                (!activeTarget || activeTarget.isStage)) {
                throw new Error('現在のスプライトにコスチュームやブロックを追加するには、スプライトを選択してください。');
            }
            if (project.backdrops.length && (!this.props.stage || !this.props.stage.id)) {
                throw new Error('ステージを取得できません。背景を追加できませんでした。');
            }
            if (hasScripts && (!AddonHooks.blockly || !AddonHooks.blocklyWorkspace)) {
                this.props.onActivateBlocksTab();
                throw new Error('コードエディターを開いてから、もう一度「素材とブロックを追加」を押してください。素材はまだ追加していません。');
            }

            for (const item of project.costumes) {
                const costume = await this.createCostumeAsset(item.svg, item.name);
                await Promise.resolve(vm.addCostume(costume.md5, costume, activeTarget.id));
                counts.costumes++;
            }

            const addedSpriteTargets = [];
            for (const spriteSpec of project.sprites) {
                const costumes = [];
                for (const item of spriteSpec.costumes) {
                    costumes.push(await this.createCostumeAsset(item.svg, item.name));
                    counts.spriteCostumes++;
                }
                const previousTargetIds = new Set(vm.runtime.targets.map(target => target.id));
                const sprite = {
                    name: spriteSpec.name,
                    isStage: false,
                    x: spriteSpec.x,
                    y: spriteSpec.y,
                    visible: true,
                    size: 100,
                    rotationStyle: 'all around',
                    direction: 90,
                    draggable: false,
                    currentCostume: 0,
                    blocks: {},
                    variables: {},
                    costumes: costumes,
                    sounds: []
                };
                await vm.addSprite(JSON.stringify(sprite));
                counts.sprites++;
                const addedTarget = vm.runtime.targets.find(target =>
                    !target.isStage && !previousTargetIds.has(target.id)
                );
                if (!addedTarget) {
                    throw new Error(`新しいスプライト「${spriteSpec.name}」の追加先を取得できませんでした。`);
                }
                addedSpriteTargets.push({
                    id: addedTarget.id,
                    name: addedTarget.getName(),
                    scripts: spriteSpec.scripts
                });
            }

            for (const item of project.backdrops) {
                const backdrop = await this.createCostumeAsset(item.svg, item.name);
                await Promise.resolve(vm.addCostume(backdrop.md5, backdrop, this.props.stage.id));
                counts.backdrops++;
            }

            const scriptGroups = [];
            if (project.scripts.length) {
                scriptGroups.push({
                    id: activeTarget.id,
                    name: activeTarget.getName(),
                    scripts: project.scripts
                });
            }
            addedSpriteTargets.forEach(target => {
                if (target.scripts.length) scriptGroups.push(target);
            });

            if (scriptGroups.length) {
                if (this.props.activeTabIndex !== BLOCKS_TAB_INDEX) {
                    this.props.onActivateBlocksTab();
                }
                try {
                    for (const group of scriptGroups) {
                        if (!vm.editingTarget || vm.editingTarget.id !== group.id) {
                            // VM emits workspaceUpdate synchronously when the editing target changes.
                            vm.setEditingTarget(group.id);
                        }
                        const result = insertProgram(
                            AddonHooks.blockly,
                            AddonHooks.blocklyWorkspace,
                            {mode: 'add', scripts: group.scripts},
                            this.props.toolboxXML
                        );
                        counts.scripts += result.count;
                        warnings.push(...result.warnings.map(warning => `${group.name}: ${warning}`));
                    }
                } finally {
                    if (initialTargetId && vm.editingTarget && vm.editingTarget.id !== initialTargetId) {
                        vm.setEditingTarget(initialTargetId);
                    }
                }
            }

            const warningText = warnings.length ? ` 注意: ${warnings.join(' / ')}` : '';
            this.setState({
                error: '',
                notice: `追加完了：既存スプライトのコスチューム ${counts.costumes}個、新規スプライト ${counts.sprites}個（専用コスチューム ${counts.spriteCostumes}個）、背景 ${counts.backdrops}個、スクリプト ${counts.scripts}個。${warningText}`
            });
        } catch (e) {
            this.setState({
                error: `追加中にエラーが発生しました: ${e.message} （追加済み: 既存コスチューム ${counts.costumes}個、新規スプライト ${counts.sprites}個・専用コスチューム ${counts.spriteCostumes}個、背景 ${counts.backdrops}個、スクリプト ${counts.scripts}個）`
            });
        } finally {
            this.applyingProject = false;
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
                onOpenSpriteLibrary={this.handleOpenSpriteLibrary}
                onAddCostume={this.handleAddCostume}
                onApplyProject={this.handleApplyProject}
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
    onOpenSpriteLibrary: PropTypes.func,
    toolboxXML: PropTypes.string,
    stage: PropTypes.shape({id: PropTypes.string}),
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    activeTabIndex: state.scratchGui.editorTab.activeTabIndex,
    toolboxXML: state.scratchGui.toolbox.toolboxXML,
    // re-render when the selected sprite changes
    editingTarget: state.scratchGui.targets.editingTarget,
    stage: state.scratchGui.targets.stage
});

const mapDispatchToProps = dispatch => ({
    onActivateBlocksTab: () => dispatch(activateTab(BLOCKS_TAB_INDEX)),
    onOpenSpriteLibrary: () => dispatch(openSpriteLibrary())
});

export default connect(mapStateToProps, mapDispatchToProps)(AISidebar);
