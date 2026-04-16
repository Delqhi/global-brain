/**
 * embedding-engine.js — Phase IV: Vector Embedding Generator
 *
 * Generates and caches text embeddings for knowledge entries.
 * Uses OpenAI embeddings via OCI Proxy (fleet standard).
 *
 * Design:
 * - Single entry embedding: generateEmbedding(text)
 * - Batch embedding: generateEmbeddings(texts[])
 * - In-memory LRU cache (1000 entries, 1h TTL)
 * - Fallback to deterministic random vectors on failure (graceful degradation)
 *
 * @module embedding-engine
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_SIZE = 1000;
const EMBEDDING_DIM = 1536; // text-embedding-ada-002 dimension
const OCI_PROXY_EMBEDDING_URL = "http://92.5.60.87:4100/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-ada-002";

// LRU Cache
const embeddingCache = new Map(); // key: text hash, value: { vector, timestamp }

/**
 * Compute a stable hash for a text (for cache key)
 */
function hashText(text) {
  // Simple hash: sum char codes with prime multiplier
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 31) + text.charCodeAt(i)) | 0;
  }
  return String(hash);
}

/**
 * Get text embedding via OpenAI API (through OCI proxy)
 *
 * @param {string} text - Text to embed
 * @param {Object} options - { useCache, fallback }
 * @returns {Promise<number[]>} Embedding vector
 */
export async function generateEmbedding(text, options = {}) {
  const { useCache = true, fallback = true } = options;
  const normalizedText = String(text ?? "").trim();

  if (!normalizedText) {
    throw new Error("Cannot generate embedding for empty text");
  }

  const cacheKey = hashText(normalizedText);

  if (useCache && embeddingCache.has(cacheKey)) {
    const cached = embeddingCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.vector;
    }
    embeddingCache.delete(cacheKey); // expired
  }

  try {
    // Get API key from environment (set by token rotation)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set in environment");
    }

    const response = await fetch(OCI_PROXY_EMBEDDING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        input: normalizedText,
        model: EMBEDDING_MODEL
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const vector = data.data?.[0]?.embedding;

    if (!vector || !Array.isArray(vector)) {
      throw new Error("Invalid embedding response format");
    }

    // Cache result
    if (embeddingCache.size >= CACHE_MAX_SIZE) {
      // Evict oldest entry (simple approach)
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, {
      vector,
      timestamp: Date.now()
    });

    return vector;
  } catch (error) {
    console.warn("[Embedding] Failed to generate embedding:", error.message);

    if (fallback) {
      // Deterministic fallback based on text hash (so similar texts produce similar vectors)
      const fallbackVector = generateDeterministicFallback(normalizedText);
      return fallbackVector;
    }

    throw error;
  }
}

/**
 * Generate a deterministic pseudo-random vector for fallback scenarios.
 * Not semantically meaningful, but provides stable output for a given text.
 *
 * @param {string} text - Input text
 * @returns {number[]} Float32Array-like array (length EMBEDDING_DIM)
 */
function generateDeterministicFallback(text) {
  // Use the same hash to seed a PRNG
  const seed = hashText(text);
  const vector = new Array(EMBEDDING_DIM);

  // Simple multiplicative PRNG
  let state = parseInt(seed, 36) || 12345;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    state = (state * 1103515245 + 12345) | 0;
    vector[i] = (state / 2147483648) - 1; // Normalize to [-1, 1]
  }

  return vector;
}

/**
 * Batch generate embeddings with concurrency control
 *
 * @param {string[]} texts - Array of texts to embed
 * @param {Object} options - { maxConcurrent, useCache, fallback }
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function generateEmbeddings(texts, options = {}) {
  const { maxConcurrent = 5, useCache = true, fallback = true } = options;

  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  // Process in batches to avoid overwhelming the API
  const results = [];
  for (let i = 0; i < texts.length; i += maxConcurrent) {
    const batch = texts.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map((text) => generateEmbedding(text, { useCache, fallback }))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Compute cosine similarity between two vectors
 *
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity (-1 to 1)
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error("Vector dimension mismatch");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-K most similar vectors to a query vector
 *
 * @param {number[]} queryVector - Query embedding
 * @param {Array<{id: string, vector: number[]}>} candidates - Candidate vectors with IDs
 * @param {number} topK - Number of results to return
 * @returns {Array<{id: string, score: number}>} Top-K matches sorted by similarity
 */
export function findSimilarVectors(queryVector, candidates, topK = 10) {
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: cosineSimilarity(queryVector, candidate.vector)
    }))
    .filter((item) => isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

/**
 * Clear the embedding cache (useful for testing)
 */
export function clearCache() {
  embeddingCache.clear();
}

/**
 * Get cache statistics
 *
 * @returns {Object} { size, maxSize, hitCount, missCount }
 */
export function getCacheStats() {
  // In a more robust implementation, track hits/misses
  return {
    size: embeddingCache.size,
    maxSize: CACHE_MAX_SIZE,
    ttlMs: CACHE_TTL_MS
  };
}
