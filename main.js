const { Plugin, Notice, PluginSettingTab, Setting, Modal } = require('obsidian');

const DEFAULT_SETTINGS = {
    productsFolder: 'Apples!/Products',
    journalFolder:  'Apples!/Journal',
    openaiApiKey:   '',
    language:       'en'
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const MEAL_SECTIONS = {
    en: ['Breakfast', 'Snack 1', 'Lunch', 'Snack 2', 'Dinner'],
    ru: ['Завтрак', 'Перекус 1', 'Обед', 'Перекус 2', 'Ужин']
};

const ALL_MEAL_SECTIONS = [
    'Breakfast', 'Snack 1', 'Lunch', 'Snack 2', 'Dinner',
    'Завтрак', 'Перекус 1', 'Обед', 'Перекус 2', 'Ужин'
];

const LABELS = {
    en: {
        headers:    ['Product', 'Weight (g)', 'Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbs (g)'],
        dailyTotal: 'Daily Total'
    },
    ru: {
        headers:    ['Продукт', 'Вес (г)', 'Калории (ккал)', 'Белки (г)', 'Жиры (г)', 'Углеводы (г)'],
        dailyTotal: 'Итого за день'
    }
};

const dailyFileTemplate = (date, lang = 'en') => {
    const sections = MEAL_SECTIONS[lang] || MEAL_SECTIONS.en;
    const totalLabel = (LABELS[lang] || LABELS.en).dailyTotal;
    return `---\ndate: ${date}\nlinks:\n  - "[[Journal]]"\n---\n\n` +
        sections.map(s => `## ${s}`).join('\n\n') +
        `\n\n## ${totalLabel}\n`;
};

class NewProductModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'New Product Card' });
        const input = contentEl.createEl('input', { type: 'text' });
        input.placeholder = 'Product name (e.g. Яблоко)';
        input.style.cssText = 'width:100%;margin-bottom:12px;padding:6px;font-size:14px;';
        input.focus();
        const btn = contentEl.createEl('button', { text: 'Create' });
        btn.style.cssText = 'width:100%;padding:8px;cursor:pointer;';
        btn.onclick = async () => {
            const name = input.value.trim();
            if (!name) return;
            this.close();
            await this.plugin.createProductCard(name);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    }
    onClose() { this.contentEl.empty(); }
}

class ApplesSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl).setName('Products folder').setDesc('Path to the folder where product cards are stored (relative to vault root)').addText(text => text.setPlaceholder('Apples!/Products').setValue(this.plugin.settings.productsFolder).onChange(async (value) => { this.plugin.settings.productsFolder = value.trim(); await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Journal folder').setDesc('Path to the folder where daily food log files are stored').addText(text => text.setPlaceholder('Apples!/Journal').setValue(this.plugin.settings.journalFolder).onChange(async (value) => { this.plugin.settings.journalFolder = value.trim(); await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Language').setDesc('Language for table headers and labels').addDropdown(drop => drop.addOption('en', 'English').addOption('ru', 'Русский').setValue(this.plugin.settings.language).onChange(async (value) => { this.plugin.settings.language = value; await this.plugin.saveSettings(); await this.plugin.updateProductSummary(); }));
        new Setting(containerEl).setName('OpenAI API key').setDesc('Used for auto-translating product names and creating product cards').addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('sk-...').setValue(this.plugin.settings.openaiApiKey).onChange(async (value) => { this.plugin.settings.openaiApiKey = value.trim(); await this.plugin.saveSettings(); }); });
    }
}

module.exports = class ApplesNutritionPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ApplesSettingTab(this.app, this));
        this.isUpdating = false;
        this._updateTimer = null;
        this._suppressUntil = 0;
        this._editLockTimer = null;
        this.addCommand({ id: 'show-product-summary', name: 'Show Product Summary', callback: () => this.updateProductSummary() });
        this.addCommand({ id: 'create-today-file', name: "Create today's food log", callback: () => this.createTodayFile() });
        this.addCommand({ id: 'create-product-card', name: 'New Product Card', callback: () => new NewProductModal(this.app, this).open() });
        this.registerEvent(this.app.vault.on('modify', (file) => {
            const activeFile = this.app.workspace.activeLeaf?.view?.file;
            if (!this.isUpdating && file.path === activeFile?.path) {
                // If the plugin itself just wrote this file, ignore the resulting modify event
                // for 5 seconds to prevent iCloud sync from re-triggering a recalculation.
                if (Date.now() < this._suppressUntil) return;
                // Write a lock file so sync script waits before downloading from server
                if (this.isJournalFile(file)) {
                    const lockPath = this.settings.journalFolder + '/.editing-lock';
                    this.app.vault.adapter.write(lockPath, Date.now().toString()).catch(() => {});
                    clearTimeout(this._editLockTimer);
                    this._editLockTimer = setTimeout(() => {
                        this.app.vault.adapter.remove(lockPath).catch(() => {});
                    }, 60000);
                }
                // Debounce: wait 1500ms after the last modification before recalculating.
                // This prevents the plugin from overwriting content while the user is still typing.
                clearTimeout(this._updateTimer);
                this._updateTimer = setTimeout(() => this.updateProductSummary(), 1500);
            }
        }));
        // Also run when switching to a journal file (e.g. after Obsidian restart or iCloud sync)
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            if (!this.isUpdating) {
                clearTimeout(this._updateTimer);
                this._updateTimer = setTimeout(() => this.updateProductSummary(), 800);
            }
        }));
    }
    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); await this.writeConfig(); }
    async saveSettings() { await this.saveData(this.settings); await this.writeConfig(); }
    async writeConfig() {
        const parts = this.settings.journalFolder.replace(/\/$/, '').split('/');
        parts.pop();
        const configPath = parts.join('/') + '/apples.config.json';
        try { await this.app.vault.adapter.write(configPath, JSON.stringify({ language: this.settings.language }, null, 2)); } catch(e) {}
    }
    isJournalFile(file) { return file.path.startsWith(this.settings.journalFolder.replace(/\/$/, '') + '/'); }
    async createTodayFile() {
        const date = new Date().toISOString().slice(0, 10);
        const folder = this.settings.journalFolder.replace(/\/$/, '');
        const monthNum = date.slice(5, 7);
        const monthFolder = `${folder}/${date.slice(0,4)}/${monthNum} ${MONTH_NAMES[parseInt(monthNum)-1]} ${date.slice(0,4)}`;
        const filePath = `${monthFolder}/${date} Apples!.md`;
        try {
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) { new Notice(`Today's file already exists: ${date} Apples!.md`); await this.app.workspace.openLinkText(filePath, '', false); return; }
            await this.app.vault.createFolder(monthFolder).catch(() => {});
            await this.app.vault.create(filePath, dailyFileTemplate(date, this.settings.language));
            await this.app.workspace.openLinkText(filePath, '', false);
            new Notice(`Created: ${date} Apples!.md`);
        } catch(e) { new Notice(`Error creating file: ${e.message}`); }
    }
    async createProductCard(name) {
        const folder = this.settings.productsFolder.replace(/\/$/, '');
        const filePath = `${folder}/${name}.md`;
        try {
            await this.app.vault.createFolder(folder).catch(() => {});
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) { new Notice(`Product "${name}" already exists`); await this.app.workspace.openLinkText(filePath, '', false); return; }
            await this.app.vault.create(filePath, `---\naliases: []\ncalories: \nprotein: \nfat: \ncarbs: \n---\n`);
            await this.app.workspace.openLinkText(filePath, '', false);
            new Notice(`Created: ${name}.md`);
        } catch(e) { new Notice(`Error: ${e.message}`); }
    }
    async updateProductSummary() {
        const file = this.app.workspace.activeLeaf?.view?.file;
        if (!file || !this.isJournalFile(file)) return;
        try {
            this.isUpdating = true;
            const content = await this.app.vault.read(file);
            const newContent = this.buildUpdatedContent(content);
            if (newContent !== content) {
                this._suppressUntil = Date.now() + 5000;
                await this.app.vault.modify(file, newContent);
            }
        } finally { this.isUpdating = false; }
    }
    parseFoodSections(content) {
        const body = content.replace(/^---[\s\S]*?---\n?/, '');
        const withoutTotal = body.replace(/^## (Daily Total|Итого за день)[\s\S]*/m, '');
        const items = [];
        const sectionRegex = /^## (.+)$/gm;
        const positions = [];
        let m;
        while ((m = sectionRegex.exec(withoutTotal)) !== null) positions.push({ name: m[1].trim(), start: m.index + m[0].length });
        positions.forEach((sec, i) => {
            if (!ALL_MEAL_SECTIONS.includes(sec.name)) return;
            const end = i + 1 < positions.length ? positions[i+1].start - positions[i+1].name.length - 4 : withoutTotal.length;
            const block = withoutTotal.slice(sec.start, end);
            const foodBlockMatch = block.match(/```food\n([\s\S]*?)```/);
            const linesToParse = foodBlockMatch ? foodBlockMatch[1].split('\n') : block.split('\n');
            linesToParse.forEach(line => {
                const cleaned = line.trim().replace(/^[\*\-\+]\s+/, '');
                const lm = cleaned.match(/^(.+?)\s+(\d+)$/);
                if (lm && parseInt(lm[2]) > 0) items.push({ name: lm[1].trim(), weight: parseInt(lm[2]) });
            });
        });
        return items;
    }
    buildUpdatedContent(content) {
        // Strip any existing daily total section (plain or div-wrapped)
        let result = content.replace(/<div class="apples-daily">[\s\S]*?<\/div>\n?/g, '');
        result = result.replace(/\n*^## (Daily Total|Итого за день)[\s\S]*/m, '');
        const items = this.parseFoodSections(result);
        if (items.length === 0) return result;
        const allRows = [];
        const allTotal = { weight: 0, calories: 0, protein: 0, fat: 0, carbs: 0 };
        items.forEach(({ name, weight }) => {
            const product = this.getProductData(name);
            if (product) {
                const factor = weight / 100;
                const cal = Math.round(parseFloat(product.calories) * factor);
                const prot = Math.round(parseFloat(product.protein) * factor);
                const fat = Math.round((parseFloat(product.fat) || 0) * factor);
                const carb = Math.round(parseFloat(product.carbs) * factor);
                allRows.push([name, weight, cal, prot, fat, carb]);
                allTotal.weight += weight; allTotal.calories += parseFloat(product.calories) * factor;
                allTotal.protein += parseFloat(product.protein) * factor;
                allTotal.fat += (parseFloat(product.fat) || 0) * factor;
                allTotal.carbs += parseFloat(product.carbs) * factor;
            } else { new Notice(`Product "${name}" not found in ${this.settings.productsFolder}`); }
        });
        if (allRows.length === 0) return result;
        const lang = LABELS[this.settings.language] || LABELS.en;
        allRows.push([`**${lang.dailyTotal}**`, Math.round(allTotal.weight), Math.round(allTotal.calories), Math.round(allTotal.protein), Math.round(allTotal.fat), Math.round(allTotal.carbs)]);
        result = result.trimEnd() + `\n\n## ${lang.dailyTotal}\n` + this.createTable(allRows, lang) + '\n';
        return result;
    }
    getProductData(productName) {
        const folder = this.settings.productsFolder.replace(/\/$/, '');
        const searchName = productName.toLowerCase().trim();
        const exactFile = this.app.vault.getAbstractFileByPath(`${folder}/${productName}.md`);
        if (exactFile) { const cache = this.app.metadataCache.getFileCache(exactFile); if (cache?.frontmatter) return cache.frontmatter; }
        const pages = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
        for (const page of pages) {
            const cache = this.app.metadataCache.getFileCache(page);
            if (!cache?.frontmatter) continue;
            const fm = cache.frontmatter;
            if (fm.alias) { const list = Array.isArray(fm.alias) ? fm.alias : [fm.alias]; if (list.some(a => typeof a === 'string' && a.toLowerCase() === searchName)) return fm; }
            if (Array.isArray(fm.aliases)) { if (fm.aliases.some(a => typeof a === 'string' && a.toLowerCase() === searchName)) return fm; }
        }
        return null;
    }
    formatNum(val) { return String(val).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
    createTable(rows, lang) {
        const labels = lang || LABELS[this.settings.language] || LABELS.en;
        const headers = labels.headers;
        const totalLabel = labels.dailyTotal;
        const alignRight = [false, true, true, true, true, true];
        const formattedRows = rows.map(row => { const isTotal = String(row[0]) === totalLabel; return row.map((cell, i) => { const val = (i > 0) ? this.formatNum(cell) : String(cell); return isTotal ? `**${val}**` : val; }); });
        const colWidths = headers.map((h, i) => Math.max(h.length, ...formattedRows.map(r => String(r[i]).length)));
        const headerRow = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';
        const separator = '| ' + colWidths.map((w, i) => alignRight[i] ? '-'.repeat(Math.max(w-1,1)) + ':' : '-'.repeat(w)).join(' | ') + ' |';
        const dataRows = formattedRows.map(row => '| ' + row.map((cell, i) => alignRight[i] ? String(cell).padStart(colWidths[i]) : String(cell).padEnd(colWidths[i])).join(' | ') + ' |');
        return [headerRow, separator, ...dataRows].join('\n');
    }
    onunload() {}
};
