// compact.js — structured context compaction for long chats.
// Distinct from summarize.js (one-line branch summaries). This produces a
// multi-section recap used to replace the bulk of a conversation when the
// token budget is running out.

const SYSTEM_PROMPT = `You are condensing a long chat so it can continue within a smaller token budget. Produce a faithful, structured recap using the exact markdown headings below. Do not add any prose outside these sections.

## Goal
One or two sentences capturing what the user is ultimately trying to accomplish.

## Key Facts & Decisions
Bulleted list of concrete facts established, decisions made, preferences stated, code written, files touched, APIs chosen, identifiers/paths/versions that matter. Preserve exact names, numbers, versions, and file paths verbatim.

## Open Threads
Bulleted list of unresolved questions, pending work, or anything explicitly deferred.

## Current State
Where the conversation left off — the most recent topic or action in progress.

Rules:
- Be terse. This recap is context for a model, not prose for a human.
- Omit pleasantries, restatements, and reasoning scratch work.
- Never invent facts that were not stated in the conversation.
- Keep the section headings exactly as shown.`;

/**
 * Compact a list of conversation messages into a structured recap.
 * @param {import('./providers/base.js').BaseProvider} provider
 * @param {string} model - user's currently selected model (used as-is; compaction needs quality)
 * @param {Array<{role: string, content: string}>} messages - messages to compact
 * @returns {Promise<string>} the structured summary, or throws on failure
 */
export async function compactMessages(provider, model, messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('nothing to compact');
  }

  const prompt = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of messages) {
    prompt.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
  }
  prompt.push({ role: 'user', content: 'Produce the structured recap now using the required section headings.' });

  const result = await provider.chat(prompt, { model, max_tokens: 1500 });
  const text = (result || '').trim();
  if (!text) throw new Error('empty compaction result');
  return text;
}
