import { Answer, Assistant, EmbeddedData, CachedData } from "./assistant";
import { sha1File } from "./utils";
import {
	App,
	MarkdownRenderer,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
} from "obsidian";

interface PluginSettings {
	apiKey: string;
	autoUpdate: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	apiKey: "",
	autoUpdate: false,
};

export default class GPTAssistantPlugin extends Plugin {
	settings: PluginSettings;
	assistant: Assistant;
	async onload() {
		this.addSettingTab(new AssistantSettings(this.app, this));
		await this.loadSettings();

		this.assistant = new Assistant(this.settings.apiKey);
		if (await this.hasCachedData()) {
			const { searchable } = await this.loadData();
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
				if (this.settings.autoUpdate) {
					this.loadEmbeddingsToAssistant(); // async update embedding
				}
				new AskAssistantModal(this.app, async (question) => {
					try {
						const answer = await this.assistant.answerQuestion(
							question
						);
						return answer;
					} catch (e) {
						if (e.response) {
							console.log(e.response)
							new Notice("❌ " + e.response.data.error.message)
						}
						return { error: true, text: "" }
					}
				}).open();
			},
		});

		this.addCommand({
			id: "update-assistant",
			name: "Update assistant",
			callback: async () => {
				if (!this.settings.apiKey) {
					new Notice("Please provide an API Key in the settings");
					return;
				}
				new Notice(
					"Loading data into model. this could take a while..."
				);
				await this.loadEmbeddingsToAssistant();
				new Notice("Your data has been loaded into the model.");

			},
		});
	}

	private async hasCachedData(): Promise<boolean> {
		const data = await this.loadData();
		return data && data.searchable && data.searchable.length;
	}

	private async loadCachedData(): Promise<CachedData> {
		const data = await this.loadData();
		if (data && data.searchable && data.searchable.length &&
			data.sha && data.sha.length) {
			return {
				searchable: data.searchable,
				sha: data.sha,
			}
		}
		return {
			searchable: [],
			sha: [],
		}
	}

	async loadEmbeddingsToAssistant() {
		const { vault } = this.app;
		const cachedData = await this.loadCachedData();
		const oldSearchable = cachedData.searchable;
		const oldSha = new Set<string>(cachedData.sha);
		const newSha = new Set<string>();

		// Load new/updated file contents
		const fileContents: EmbeddedData = (await Promise.all(
			vault
				.getMarkdownFiles()
				.map((file) => {
					const sha1 = sha1File(file);
					newSha.add(sha1);
					if (oldSha.has(sha1)) { // file doesn't change
						return { text: '', embeddings: [], sha1: sha1 };
					}
					return vault.cachedRead(file).then((res) => {
						return { text: file.name + res, embeddings: [], sha1: sha1 }
					})
				})
		)).filter(f => f.text.length);

		let searchable = oldSearchable.filter((e) => oldSha.has(e.sha1) && newSha.has(e.sha1));
		if (fileContents.length) { // create embeddings for new/updated files
			const chunks = this.assistant.prepareTexts(fileContents);
			try {
				const newSearchable = await this.assistant.createEmbeddings(chunks);
				searchable = newSearchable.concat(searchable);
				new Notice("Your data has been loaded into the model.");

			} catch (e) {
				if (e.response) {
					console.log(e.response)
					new Notice("❌ " + e.response.data.error.message)
				}
			}
		}

		this.saveNamedData({
			"searchable": searchable,
			"sha": Array.from(newSha),
		});
		this.assistant.setData(searchable);
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData())?.settings ?? {}
		);
	}

	async saveSettings() {
		this.assistant = new Assistant(this.settings.apiKey);
		await this.saveData({
			...(await this.loadData()),
			settings: this.settings,
		});
	}

	async saveNamedData(data: CachedData) {
		await this.saveData({ ...(await this.loadData()), ...data });
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
	plugin: GPTAssistantPlugin;

	constructor(app: App, plugin: GPTAssistantPlugin) {
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
			.setName("Automatically update")
			.setDesc("Automatically load new notes into the assistant")
			.addToggle((tg) => {
				tg.setValue(this.plugin.settings.autoUpdate);
				tg.onChange(async (value) => {
					this.plugin.settings.autoUpdate = value;
					await this.plugin.saveSettings();
				});
			})

		new Setting(containerEl)
			.setName("Process notes")
			.setDesc("Load all your notes into the assistant")
			.addButton((btn) => {
				btn.setButtonText("Process").setCta();

				btn.onClick(async (e) => {
					if (this.plugin?.settings?.apiKey == "") {
						new Notice("Please provide an API Key");
						return;
					}
					new Notice(
						"Loading data into model. this could take a while..."
					);
					await this.plugin.loadEmbeddingsToAssistant();

				});
			});
	}
}
