import PropTypes from 'prop-types';
import React from 'react';
import AddonHooks from '../../addons/hooks.js';

import styles from './ai-sidebar.css';

/**
 * Renders scratch-blocks XML in a small read-only workspace.
 */
class BlockPreview extends React.Component {
    constructor (props) {
        super(props);
        this.container = null;
        this.workspace = null;
        this.setRef = el => {
            this.container = el;
        };
        this.state = {failed: false};
    }
    componentDidMount () {
        this.renderBlocks();
    }
    componentDidUpdate (prevProps) {
        if (prevProps.xml !== this.props.xml) this.renderBlocks();
    }
    componentWillUnmount () {
        this.disposeWorkspace();
    }
    disposeWorkspace () {
        if (this.workspace) {
            try {
                this.workspace.dispose();
            } catch (e) {
                // ignore
            }
            this.workspace = null;
        }
    }
    renderBlocks () {
        const ScratchBlocks = AddonHooks.blockly;
        const mainWorkspace = AddonHooks.blocklyWorkspace;
        if (!ScratchBlocks || !mainWorkspace || !this.container) {
            this.setState({failed: true});
            return;
        }
        this.disposeWorkspace();
        this.container.innerHTML = '';
        const previousMain = ScratchBlocks.mainWorkspace;
        try {
            this.workspace = ScratchBlocks.inject(this.container, {
                readOnly: true,
                media: mainWorkspace.options.pathToMedia,
                scrollbars: false,
                trashcan: false,
                sounds: false,
                zoom: {startScale: 0.55},
                rtl: mainWorkspace.RTL
            });
            const dom = ScratchBlocks.Xml.textToDom(this.props.xml);
            ScratchBlocks.Xml.domToWorkspace(dom, this.workspace);

            // Lay scripts out vertically
            let y = 12;
            for (const block of this.workspace.getTopBlocks(true)) {
                const xy = block.getRelativeToSurfaceXY();
                block.moveBy(12 - xy.x, y - xy.y);
                y += block.getHeightWidth().height + 24;
            }
            const box = this.workspace.getBlocksBoundingBox();
            const scale = this.workspace.scale;
            const height = Math.min(360, Math.max(48, ((box.y + box.height + 12) * scale) + 4));
            this.container.style.height = `${height}px`;
            ScratchBlocks.svgResize(this.workspace);
            this.setState({failed: false});
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('AI block preview failed', e);
            this.disposeWorkspace();
            this.setState({failed: true});
        } finally {
            // Injecting changes Blockly's "main" workspace; restore the real editor
            ScratchBlocks.mainWorkspace = previousMain || mainWorkspace;
        }
    }
    render () {
        return (
            <div className={styles.previewWrapper}>
                <div
                    className={styles.preview}
                    ref={this.setRef}
                />
                {this.state.failed ? (
                    <pre className={styles.previewFallback}>{this.props.fallbackText}</pre>
                ) : null}
            </div>
        );
    }
}

BlockPreview.propTypes = {
    fallbackText: PropTypes.string,
    xml: PropTypes.string.isRequired
};

export default BlockPreview;
