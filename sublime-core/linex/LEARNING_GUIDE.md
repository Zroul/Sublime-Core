# LINEX engineering learning guide

This guide teaches the ideas used while building LINEX. Read the matching section before changing that part of the code.

## 1. LLMs

A large language model (LLM) reads tokens and generates likely next tokens. It can explain code and propose actions, but it does not automatically know the current contents of a project, execute tools, or remember every past conversation.

In this repository, CORE is the model identity and Ollama is the local runtime/provider. LINEX reuses that existing model; it does not create a second model.

**Key lesson:** the model proposes; application code decides what is allowed and performs the actual work.

## 2. APIs and HTTP

An API is a defined way for two pieces of software to communicate. An HTTP API sends requests and receives responses over HTTP.

Ollama exposes a local chat endpoint. The provider in `core/ai/providers/ollama.ts` sends the model name, messages, and tool schemas to that endpoint. LINEX calls the provider through the shared `LlmClient` interface.

Important terms:
- **Request:** the data sent to the API.
- **Response:** the data returned by the API.
- **Endpoint:** the API route being called.
- **Schema:** the shape and types of accepted data.
- **Timeout:** the maximum time a request may wait.
- **Error handling:** how the app responds when the API is unavailable or returns invalid data.

**Key lesson:** keep provider-specific HTTP code in the provider adapter, not scattered through the agent.

## 3. Tool calling and the ReAct loop

A tool is a normal program function exposed to the model through a name, description, and input schema.

LINEX uses the shared ReAct loop:

1. The model receives the task and available tool descriptions.
2. The model requests a tool call.
3. The runtime validates and executes the call.
4. The runtime sends the observation back to the model.
5. The model decides what to do next or finishes.

This is often described as **Think → Act → Observe**. The model's proposed tool call is not proof that the action succeeded; only the tool result is evidence.

**Key lesson:** tool permissions belong in application code. A prompt saying “do not access secrets” is not a security boundary by itself.

## 4. RAG

Retrieval-Augmented Generation (RAG) lets an LLM answer using selected information from a document collection.

A typical RAG pipeline:

1. Load documents from approved sources.
2. Split documents into useful chunks.
3. Create an embedding for each chunk.
4. Store embeddings and metadata in an index.
5. Embed the user's question.
6. Retrieve the most relevant chunks.
7. Optionally rerank the results.
8. Put the selected evidence into the model prompt.
9. Generate an answer with source references.

An **embedding** is a vector representation that helps compare semantic meaning. A vector database or vector index stores and searches those vectors.

RAG is not model fine-tuning. It does not permanently teach new facts to the model; it retrieves relevant context at query time.

**LINEX status:** RAG is not implemented in v1. Do not describe LINEX as having a knowledge base or document retrieval until an index, retrieval path, and evaluation tests actually exist.

## 5. Verification and tests

A successful tool response confirms that a particular operation reported success. It does not prove the resulting application is correct.

LINEX now has a completion gate:
- a requested change must produce a successful file write;
- every changed file must then be read again;
- a later edit invalidates the earlier read-back check;
- failed writes do not count as completed work.

Tests provide another level of evidence:
- **Unit test:** checks one function or module.
- **Integration test:** checks that multiple components work together.
- **End-to-end test:** checks a complete user workflow.

The LINEX self-tests cover path safety, nested file creation, and the completion gate. They do not replace OBSIDIAN application tests.

**Key lesson:** report exactly which checks ran. Never turn “I inspected the code” into “the tests passed.”

## 6. Git and safe collaboration

A branch isolates a set of changes. A pull request lets another person inspect those changes before they are merged.

Recommended workflow:
1. Inspect the current branch and working tree.
2. Create a focused feature branch.
3. Read the files before editing.
4. Make the smallest useful change.
5. Run relevant tests.
6. Re-read the changed files and inspect the diff.
7. Open a pull request with evidence and known limitations.
8. Merge only after review and confirmation.

LINEX v1 deliberately cannot commit, push, merge, or delete files.

## 7. Suggested intern practice

1. Trace a user message from `linex/run.ts` to `OllamaProvider`.
2. Explain the difference between an LLM, a provider, an API, and a tool.
3. Add one safe read-only tool and write a unit test for its path restrictions.
4. Add one small file-edit capability and prove the completion gate blocks finishing before read-back.
5. Sketch a RAG design for approved project documentation. Do not implement a vector database until the data sources, privacy rules, and evaluation set are defined.
