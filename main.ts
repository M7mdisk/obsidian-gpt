import { Answer, Assistant } from "assistant";
import {
	App,
	Component,
	MarkdownPreviewRenderer,
	MarkdownRenderer,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
} from "obsidian";
// TODO: Remember to rename these classes and interfaces!

interface MyPluginSettings {
	apiKey: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: "",
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	assistant: Assistant;
	async onload() {
		this.addSettingTab(new AssistantSettings(this.app, this));
		await this.loadSettings();

		this.assistant = new Assistant(this.settings.apiKey);
		if (await this.hasCachedData()) {
			let { searchable } = await this.loadData();
			this.saveNamedData("searchable", searchable);
			this.assistant.setData(searchable);
		}

		this.addCommand({
			id: "ask-assistant",
			name: "Ask assistant",
			callback: async () => {
				if (!(await this.hasCachedData())) {
					new Notice(
						"You must load data before asking question, you can do so from the plugin settings"
					);
					return;
				}
				if (!this.settings.apiKey) {
					new Notice("Please provide an API Key in the settings");
					return;
				}
				new AskAssistantModal(this.app, async (question) => {
					const answer = await this.assistant.answerQuestion(
						question
					);
					return answer ?? "";
				}).open();
			},
		});
	}

	private async hasCachedData(): Promise<boolean> {
		const data = await this.loadData();
		return data.searchable && data.searchable.length;
	}

	async loadEmbeddingsToAssistant() {
		const { vault } = this.app;
		const fileContents: string[] = await Promise.all(
			vault
				.getMarkdownFiles()
				.map((file) =>
					vault.cachedRead(file).then((res) => file.name + res)
				)
		);
		const chunks = await this.assistant.prepareTexts(fileContents);
		const searchable = await this.assistant.createEmbeddings(chunks);
		this.saveNamedData("searchable", searchable);
		this.assistant.setData(searchable);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()).settings
		);
	}

	async saveSettings() {
		this.assistant = new Assistant(this.settings.apiKey);
		await this.saveData({
			...(await this.loadData()),
			settings: this.settings,
		});
	}

	async saveNamedData(name: string, data: unknown) {
		await this.saveData({ ...(await this.loadData()), [name]: data });
	}
}

class AskAssistantModal extends Modal {
	result: string;
	onSubmit: (result: string) => Promise<Answer>;
	constructor(app: App, onSubmit: (result: string) => Promise<Answer>) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		const answer_div = contentEl.createEl("div", {
			text: "",
			cls: "answer",
		});
		const promptTextArea = new TextAreaComponent(contentEl);
		promptTextArea.onChange((text) => {
			this.result = text;
		});
		promptTextArea.setPlaceholder("Enter your prompt...");
		promptTextArea.inputEl.classList.add("prompt_in");

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Ask Assistant")
				.setCta()
				.onClick(async () => {
					answer_div.innerText = "Loading.....";
					const answer = await this.onSubmit(this.result);
					answer_div.innerText = "";
					if (answer.error) {
						new Notice(answer.text);
						return;
					}
					MarkdownRenderer.renderMarkdown(
						answer.text,
						answer_div,
						"",
						null as any
					);
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AssistantSettings extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Obsidian-GPT Assistant settings" });

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"Your OpenAI API key. Can be found at https://platform.openai.com/account/api-keys"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Process notes")
			.setDesc("Load all your notes into the assistant")
			.addButton((btn) => {
				btn.setButtonText("Process").setCta();

				btn.onClick(async (e) => {
					if (this.plugin.settings.apiKey == "") {
						new Notice("Please provide an API Key");
						return;
					}
					new Notice(
						"Loading data into model. this could take a while..."
					);
					await this.plugin.loadEmbeddingsToAssistant();

					new Notice("Your data has been loaded into the model.");
				});
			});
	}
}
