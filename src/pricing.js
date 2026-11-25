'use strict';

const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');

// USD per million tokens for standard short-context OpenAI API requests, verified 2026-11-25.
// https://developers.openai.com/api/docs/pricing
const rates = new Map([
  ['gpt-6.2-sol', [2, 0.10, 10]],
  ['gpt-6.2-astra', [8, 0.40, 40]],
  ['gpt-6.1-sol', [2, 0.10, 10]],
  ['gpt-6-astra', [10, 1, 50]],
]);
const MAX_FRAME = 512_000;

function estimate(response, eligible) {
  const price = rates.get(response?.model);
  const usage = response?.usage;
  const tier = response?.service_tier;
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens;
  if (!eligible || !price || !['default', 'standard'].includes(tier)) return null;
  if (![input, cached, output].every(value => Number.isSafeInteger(value) && value >= 0) || input > 128_000 || cached > input) return null;
  return ((input - cached) * price[0] + cached * price[1] + output * price[2]) / 1_000_000;
}

function observeUsage(input, streaming, received) {
  const eligible = !input.prompt_cache_retention || input.prompt_cache_retention === 'in_memory';
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let seen = false;
  let invalid = false;
  function parse(payload) {
    if (seen || invalid) return;
    try {
      const value = JSON.parse(payload);
      if (!streaming || ['response.completed', 'response.incomplete'].includes(value?.type)) {
        seen = true;
        received(estimate(streaming ? value.response : value, eligible));
      }
    } catch { /* Upstream content is passed through byte for byte. */ }
  }
  function read(chunk, final = false) {
    if (invalid || seen) return;
    buffer += chunk;
    if (streaming) {
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (frame.length <= MAX_FRAME) {
          const lines = frame.split(/\r?\n/).filter(line => line.startsWith('data:'));
          if (lines.some(line => /"response\.(completed|incomplete)"/.test(line))) parse(lines.map(line => line.slice(5).trimStart()).join('\n'));
        }
      }
    } else if (final && buffer.length <= MAX_FRAME) parse(buffer);
    if (buffer.length > MAX_FRAME) { buffer = ''; invalid = true; }
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      read(decoder.write(chunk));
      callback(null, chunk);
    },
    flush(callback) {
      read(decoder.end(), true);
      if (!seen) received(null);
      callback();
    },
  });
}

module.exports = { estimate, observeUsage };
