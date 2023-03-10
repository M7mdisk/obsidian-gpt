function dotProduct(vecA: number[], vecB: number[]) {
	let product = 0;
	for (let i = 0; i < vecA.length; i++) {
		product += vecA[i] * vecB[i];
	}
	return product;
}

function magnitude(vec: number[]) {
	let sum = 0;
	for (let i = 0; i < vec.length; i++) {
		sum += vec[i] * vec[i];
	}
	return Math.sqrt(sum);
}

export function cosineSimilarity(vecA: number[], vecB: number[]) {
	return dotProduct(vecA, vecB) / (magnitude(vecA) * magnitude(vecB));
}
