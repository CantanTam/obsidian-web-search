const { Plugin, PluginSettingTab, Setting, ItemView, Notice, Platform } = require('obsidian');

class WebviewView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return 'webview-view';
    }

    getDisplayText() {
        if (this.plugin.currentEngineName) {
            return this.plugin.currentEngineName;
        }
        return 'Webview';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        const webviewContainer = document.createElement('div');
        webviewContainer.setAttribute('style', 'width: 100%; height: 100%; position: relative;');

        const webview = document.createElement('webview');
        webview.setAttribute('style', 'width: 100%; height: 100%;');
        webview.setAttribute('partition', 'persist:webview');  // 保持Webview会话持久化

        if (this.plugin.settings.useMobileUserAgent) {
            webview.setAttribute('useragent', 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.93 Mobile Safari/537.36');
        }

        webview.addEventListener('did-finish-load', () => {
            // 去除 Google 广告
            webview.executeJavaScript(`
            let ads = document.querySelectorAll('iframe[src*="google"]');
            ads.forEach(ad => ad.remove());
            `);
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.setAttribute('style', `position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 1000; ${this.getButtonOpacityStyle()}`);

        const backButton = document.createElement('button');
        backButton.innerText = '←';
        backButton.addEventListener('click', () => {
            webview.goBack();
        });

        const forwardButton = document.createElement('button');
        forwardButton.innerText = '→';
        forwardButton.addEventListener('click', () => {
            webview.goForward();
        });

        buttonContainer.appendChild(backButton);
        buttonContainer.appendChild(forwardButton);

        webviewContainer.appendChild(webview);
        webviewContainer.appendChild(buttonContainer);
        container.appendChild(webviewContainer);
        this.webview = webview;

        this.addButtonHoverEffect(buttonContainer, backButton, forwardButton);
    }

    async onClose() {
        // 清理工作
    }

    setUrl(url) {
        if (this.webview) {
            this.webview.setAttribute('src', url);
        }
    }

    getButtonOpacityStyle() {
        switch (this.plugin.settings.buttonOpacity) {
            case '半透明':
                return 'opacity: 0.5;';
            case '全透明':
                return 'opacity: 0; transition: opacity 0.3s;';
            default:
                return 'opacity: 1;';
        }
    }

    addButtonHoverEffect(buttonContainer, backButton, forwardButton) {
        if (this.plugin.settings.buttonOpacity === '全透明') {
            buttonContainer.addEventListener('mouseover', () => {
                buttonContainer.style.opacity = '1';
            });
            buttonContainer.addEventListener('mouseout', () => {
                buttonContainer.style.opacity = '0';
            });
        }
    }
}

class WebSearchPlugin extends Plugin {
    async onload() {
        console.log('Web Search plugin loaded');
        await this.loadSettings();

        this.registerView('webview-view', (leaf) => new WebviewView(leaf, this));

        this.addRibbonIcon('globe', 'Open Web Search Webview', () => {
            this.activateView('');
        });

        this.addSettingTab(new WebSearchSettingTab(this.app, this));

        this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
            const selectedText = editor.getSelection();
            const customEngines = this.settings.customSearchEngines;

            customEngines.filter(engine => engine.selected).forEach((engine) => {
                menu.addItem((item) => {
                    item.setTitle(engine.name)
                    .setIcon("search")
                    .onClick(async () => {
                        const searchUrl = `${engine.url}${encodeURIComponent(selectedText)}`;
                        this.activateWebview(searchUrl, engine.name);
                    });
                });
            });

            if (customEngines.length === 0) {
                menu.addItem((item) => {
                    item.setTitle("无自定义搜索引擎")
                    .setIcon("search")
                    .onClick(() => {
                        new Notice("请在设置中添加一个自定义搜索引擎");
                    });
                });
            }
        }));

        this.addCommandsForCustomEngines();
    }

    onunload() {
        this.app.workspace.detachLeavesOfType('webview-view');
        console.log('Web Search plugin unloaded');
    }

    async activateWebview(url, engineName) {
        let leaf = this.app.workspace.getLeavesOfType('webview-view').first();
        if (!leaf) {
            leaf = this.app.workspace.getLeaf(true);
            await leaf.setViewState({
                type: 'webview-view',
                active: true
            });
        }
        const view = leaf.view;
        if (view instanceof WebviewView) {
            this.currentEngineName = engineName;
            view.setUrl(url);
            leaf.setViewState({ type: 'webview-view', active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    async activateView() {
        this.activateWebview('', '');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    addCommandsForCustomEngines() {
        this.settings.customSearchEngines.forEach((engine) => {
            this.addCommand({
                id: `search-with-${engine.name}`,
                name: `使用 ${engine.name} 搜索`,
                checkCallback: (checking) => {
                    if (checking) {
                        return !!this.app.workspace.activeEditor;
                    }
                    const editor = this.app.workspace.activeEditor;
                    if (editor) {
                        const selectedText = editor.getSelection();
                        const searchUrl = `${engine.url}${encodeURIComponent(selectedText)}`;
                        this.activateWebview(searchUrl, engine.name);
                    }
                },
            });
        });
    }
}

const DEFAULT_SETTINGS = {
    useMobileUserAgent: false,
    buttonOpacity: '不透明',
    customSearchEngines: [],
};

class WebSearchSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Web Search Settings' });

        new Setting(containerEl)
        .setName('使用手机模式')
        .setDesc('开启后模拟Android手机，减少广告')
        .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useMobileUserAgent)
        .onChange(async (value) => {
            this.plugin.settings.useMobileUserAgent = value;
            await this.plugin.saveSettings();
        }));

        new Setting(containerEl)
        .setName('搜索页面返回、前进按钮透明度')
        .setDesc('设置返回和前进按钮的透明度')
        .addDropdown(dropdown => dropdown
        .addOption('不透明', '不透明')
        .addOption('半透明', '半透明')
        .addOption('全透明', '全透明')
        .setValue(this.plugin.settings.buttonOpacity)
        .onChange(async (value) => {
            this.plugin.settings.buttonOpacity = value;
            await this.plugin.saveSettings();
        }));

        new Setting(containerEl)
        .setName('自定义搜索引擎')
        .setDesc('勾选的搜索引擎会出现在右击菜单上');

        const enginesContainer = containerEl.createDiv();
        enginesContainer.setAttr('style', 'display: flex; flex-direction: column;');

        this.plugin.settings.customSearchEngines.forEach((engine, index) => {
            const engineEl = enginesContainer.createDiv();
            engineEl.setAttr('style', 'display: flex; align-items: center; margin-bottom: 5px;');
            engineEl.setAttr('draggable', 'true');

            engineEl.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', index.toString());
            };

            engineEl.ondragover = (e) => {
                e.preventDefault();
                engineEl.setAttr('style', 'display: flex; align-items: center; margin-bottom: 5px; background: #ddd;');
            };

            engineEl.ondragleave = (e) => {
                engineEl.setAttr('style', 'display: flex; align-items: center; margin-bottom: 5px;');
            };

            engineEl.ondrop = async (e) => {
                e.preventDefault();
                const draggedIndex = e.dataTransfer.getData('text/plain');
                const droppedIndex = index;

                if (draggedIndex !== droppedIndex) {
                    const draggedEngine = this.plugin.settings.customSearchEngines[draggedIndex];
                    this.plugin.settings.customSearchEngines.splice(draggedIndex, 1);
                    this.plugin.settings.customSearchEngines.splice(droppedIndex, 0, draggedEngine);
                    await this.plugin.saveSettings();
                    this.display();
                }
            };

            new Setting(engineEl)
            .addToggle(toggle => toggle
            .setValue(engine.selected)
            .onChange(async (value) => {
                this.plugin.settings.customSearchEngines[index].selected = value;
                await this.plugin.saveSettings();
            }))
            .addText(text => text
            .setValue(engine.name)
            .setPlaceholder('搜索引擎名字')
            .onChange(async (value) => {
                this.plugin.settings.customSearchEngines[index].name = value;
                await this.plugin.saveSettings();
            }).inputEl.style.width = '100px')
            .addText(text => text
            .setValue(engine.url)
            .setPlaceholder('https://www.xxx.com')
            .onChange(async (value) => {
                this.plugin.settings.customSearchEngines[index].url = value;
                await this.plugin.saveSettings();
            }).inputEl.style.width = '500px')
            .addButton(button => button
            .setButtonText("删除")
            .setCta()
            .onClick(async () => {
                this.plugin.settings.customSearchEngines.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            }));
        });

        new Setting(containerEl)
        .addButton(button => button
        .setButtonText("添加新的搜索引擎")
        .setCta()
        .onClick(async () => {
            this.plugin.settings.customSearchEngines.push({ name: '', url: '', selected: false });
            await this.plugin.saveSettings();
            this.display();
        }));

        new Setting(containerEl)
        .addButton(button => button
        .setButtonText("打开B站查看本插件教程")
        .setCta()
        .onClick(() => {
            if (Platform.isDesktop) {
                require('electron').shell.openExternal('https://www.bilibili.com/video/BV1KPvNeuECD');
            } else {
                window.open('https://www.bilibili.com', '_blank');
            }
        }));
    }
}

module.exports = WebSearchPlugin;
