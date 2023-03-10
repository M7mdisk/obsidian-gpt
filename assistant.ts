import { Configuration, OpenAIApi } from "openai";
import GPT3Tokenizer from "gpt3-tokenizer";
import { cosineSimilarity } from "utils";

export interface chunkData {
	text: string;
	embeddings: number[];
}

export type EmbeddedData = chunkData[];

export type Answer = { error: boolean; text: string };
export class Assistant {
	MAX_TOKENS = 500;
	openai: OpenAIApi;
	tokenizer: GPT3Tokenizer;
	searchable?: EmbeddedData;
	constructor(apiKey: string) {
		const configuration = new Configuration({
			apiKey: apiKey,
		});
		this.openai = new OpenAIApi(configuration);
		this.tokenizer = new GPT3Tokenizer({ type: "gpt3" });
	}

	setData(emb: EmbeddedData) {
		this.searchable = emb;
	}

	private async createContext(question: string, maxLength = 1800) {
		if (this.searchable == null) throw new Error("NO SEARCHABLE DATA");
		const questionEmbeddings = (
			await this.openai.createEmbedding({
				input: question,
				model: "text-embedding-ada-002",
			})
		).data.data[0].embedding;
		const sortedData = this.searchable.sort(
			(a, b) =>
				cosineSimilarity(questionEmbeddings, b.embeddings) -
				cosineSimilarity(questionEmbeddings, a.embeddings)
		);
		const returns = [];
		let cur_len = 0;
		for (const row of sortedData) {
			const n_tokens = this.tokenizer.encode(row.text).bpe.length;
			cur_len += n_tokens + 4;
			if (cur_len > maxLength) break;
			returns.push(row.text);
		}
		return returns.join("\n\n###\n\n");
	}
	async answerQuestion(
		question: string,
		maxLength = 1800,
		maxTokens = 150,
		stopSequence = null
	): Promise<Answer> {
		if (this.searchable == null)
			return {
				error: true,
				text: "Data not loaded. Please load it from settings",
			};
		const context = await this.createContext(question, maxLength);
		const response = await this.openai.createCompletion({
			prompt: `Answer the question based on the context below, and if the question can't be answered based on the context, say "I don't know, I couldn't find anything related to this in your notes."\n\nContext: ${context}\n\n---\n\nQuestion: ${question}\nAnswer:`,
			temperature: 0,
			max_tokens: maxTokens,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
			stop: stopSequence,
			model: "text-davinci-003",
		});
		return {
			error: false,
			text: response.data.choices[0].text ?? "Something went wrong.",
		};
	}

	prepareTexts(texts: string[]): string[] {
		let shortened: string[] = [];
		texts.forEach((text) => {
			if (this.tokenizer.encode(text).bpe.length > this.MAX_TOKENS) {
				shortened = shortened.concat(this.splitIntoMany(text));
			} else {
				shortened.push(text);
			}
		});
		return shortened;
	}

	private splitIntoMany(text: string, max_tokens = 500): string[] {
		const sentences = text.split(". ");
		const n_tokens = sentences.map(
			(sentence) => this.tokenizer.encode(" " + sentence).bpe.length
		);
		let tokens_so_far = 0;
		const chunks: string[] = [];
		const chunk: string[] = [];
		sentences.forEach((sentence, idx) => {
			const token = n_tokens[idx];
			if (token + tokens_so_far > max_tokens) {
				chunks.push(chunk.join(". ") + ".");
				chunk.length = 0;
				tokens_so_far = 0;
			}
			if (!(token > max_tokens)) {
				chunk.push(sentence);
				tokens_so_far += token + 1;
			}
		});
		return chunks;
	}
	async createEmbeddings(data: string[]): Promise<EmbeddedData> {
		const embeddings = await this.openai.createEmbedding({
			input: data,
			model: "text-embedding-ada-002",
		});
		return data.map((text, idx) => ({
			text,
			embeddings: embeddings.data.data[idx].embedding,
		}));
	}
}
