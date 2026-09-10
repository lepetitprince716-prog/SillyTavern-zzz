import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SAMPLERS,
    SUPPORTED_SAMPLERS,
    TEXT_BACKENDS,
    type SamplerValues,
    type TextBackend,
} from '@/features/textcompletion/backends';
import {
    buildTextRequest,
    extractTextDelta,
    extractTextError,
    extractTextResult,
    novelTokenizer,
    type TextRequest,
} from './text-completion';

function request(patch: Partial<TextRequest> = {}): TextRequest {
    return {
        backend: 'ooba',
        prompt: 'Once upon a time',
        stop: ['\nUser:'],
        maxTokens: 300,
        maxContext: 4096,
        samplers: { ...DEFAULT_SAMPLERS },
        stream: false,
        url: 'http://127.0.0.1:5000',
        ...patch,
    };
}

/** Samplers set to a value that is definitely not neutral. */
const ALL_ACTIVE: SamplerValues = {
    temperature: 0.9,
    top_p: 0.95,
    top_k: 40,
    min_p: 0.05,
    top_a: 0.1,
    typical_p: 0.95,
    tfs: 0.95,
    repetition_penalty: 1.1,
    repetition_penalty_range: 512,
    frequency_penalty: 0.1,
    presence_penalty: 0.1,
    mirostat_mode: 2,
    mirostat_tau: 4,
    mirostat_eta: 0.2,
    seed: 1234,
};

describe('buildTextRequest routing', () => {
    it('sends every backend to the route that serves it', () => {
        const paths = new Map<TextBackend, string>();
        for (const backend of TEXT_BACKENDS) {
            paths.set(backend, buildTextRequest(request({ backend })).path);
        }
        expect(paths.get('ooba')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('llamacpp')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('ollama')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('tabby')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('vllm')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('generic')).toBe('/api/backends/text-completions/generate');
        expect(paths.get('kobold')).toBe('/api/backends/kobold/generate');
        expect(paths.get('novel')).toBe('/api/novelai/generate');
        expect(paths.get('horde')).toBe('/api/horde/generate-text');
    });

    it('names the api_type the multiplexing route switches on', () => {
        expect(buildTextRequest(request({ backend: 'llamacpp' })).body.api_type).toBe('llamacpp');
        expect(buildTextRequest(request({ backend: 'vllm' })).body.api_type).toBe('vllm');
    });

    it('carries the prompt under the name each backend uses', () => {
        expect(buildTextRequest(request()).body.prompt).toBe('Once upon a time');
        expect(buildTextRequest(request({ backend: 'kobold' })).body.prompt).toBe('Once upon a time');
        // NovelAI calls it `input`.
        expect(buildTextRequest(request({ backend: 'novel' })).body.input).toBe('Once upon a time');
        expect(buildTextRequest(request({ backend: 'novel' })).body.prompt).toBeUndefined();
    });
});

describe('buildTextRequest sampler naming', () => {
    it('uses ooba spellings for ooba', () => {
        const { body } = buildTextRequest(request({ samplers: ALL_ACTIVE }));
        expect(body.repetition_penalty).toBe(1.1);
        expect(body.repetition_penalty_range).toBe(512);
        expect(body.tfs).toBe(0.95);
        expect(body.mirostat_mode).toBe(2);
        expect(body.max_tokens).toBe(300);
    });

    it('uses llama.cpp spellings for llama.cpp', () => {
        const { body } = buildTextRequest(request({ backend: 'llamacpp', samplers: ALL_ACTIVE }));
        expect(body.repeat_penalty).toBe(1.1);
        expect(body.repeat_last_n).toBe(512);
        expect(body.tfs_z).toBe(0.95);
        expect(body.mirostat).toBe(2);
        expect(body.n_predict).toBe(300);
        // The ooba names must not also be present: the classic UI sends both
        // and it is why its panel cannot say which control matters.
        expect(body.repetition_penalty).toBeUndefined();
        expect(body.max_tokens).toBeUndefined();
        expect(body.mirostat_mode).toBeUndefined();
    });

    it('uses Ollama spellings for Ollama', () => {
        const { body } = buildTextRequest(request({ backend: 'ollama', samplers: ALL_ACTIVE }));
        expect(body.num_predict).toBe(300);
        expect(body.num_ctx).toBe(4096);
        expect(body.repeat_penalty).toBe(1.1);
        expect(body.tfs_z).toBe(0.95);
    });

    it('uses the Kobold whitelist names for Kobold', () => {
        const { body } = buildTextRequest(request({ backend: 'kobold', samplers: ALL_ACTIVE }));
        expect(body.rep_pen).toBe(1.1);
        expect(body.rep_pen_range).toBe(512);
        expect(body.typical).toBe(0.95);
        expect(body.mirostat).toBe(2);
        expect(body.sampler_seed).toBe(1234);
        expect(body.max_length).toBe(300);
        expect(body.max_context_length).toBe(4096);
    });

    it('uses NovelAI spellings for NovelAI', () => {
        const { body } = buildTextRequest(request({ backend: 'novel', samplers: ALL_ACTIVE }));
        expect(body.tail_free_sampling).toBe(0.95);
        expect(body.repetition_penalty).toBe(1.1);
        expect(body.max_length).toBe(300);
    });

    it('nests the Horde sampler settings under params', () => {
        const { body } = buildTextRequest(request({ backend: 'horde', samplers: ALL_ACTIVE }));
        expect(body.params).toMatchObject({ rep_pen: 1.1, max_length: 300, max_context_length: 4096 });
        // Flat sampler fields would be ignored by the Horde API.
        expect(body.rep_pen).toBeUndefined();
    });
});

describe('buildTextRequest sampler filtering', () => {
    it('never sends a sampler the backend cannot use', () => {
        for (const backend of TEXT_BACKENDS) {
            const { body } = buildTextRequest(request({ backend, samplers: ALL_ACTIVE }));
            const sent = backend === 'horde'
                ? (body.params as Record<string, unknown>)
                : body;
            // Only checks the samplers, not the routing and length fields.
            const supported = new Set<string>(SUPPORTED_SAMPLERS[backend]);
            if (!supported.has('mirostat_mode')) {
                for (const name of ['mirostat', 'mirostat_mode', 'mirostat_tau', 'mirostat_eta']) {
                    expect(sent[name], `${backend}.${name}`).toBeUndefined();
                }
            }
            if (!supported.has('tfs')) {
                for (const name of ['tfs', 'tfs_z', 'tail_free_sampling']) {
                    expect(sent[name], `${backend}.${name}`).toBeUndefined();
                }
            }
            if (!supported.has('top_a')) {
                expect(sent.top_a, `${backend}.top_a`).toBeUndefined();
            }
            if (!supported.has('frequency_penalty')) {
                expect(sent.frequency_penalty, `${backend}.frequency_penalty`).toBeUndefined();
            }
        }
    });

    it('sends only the OpenAI parameters for a generic endpoint', () => {
        const { body } = buildTextRequest(request({ backend: 'generic', samplers: ALL_ACTIVE }));
        expect(body.temperature).toBe(0.9);
        expect(body.top_p).toBe(0.95);
        expect(body.frequency_penalty).toBe(0.1);
        // OPENAI_KEYS has no top_k, min_p, tfs or mirostat, and the server
        // filters them out anyway — so sending them is pure noise.
        expect(body.top_k).toBeUndefined();
        expect(body.min_p).toBeUndefined();
    });

    it('omits a sampler sitting at the value that disables it', () => {
        const neutral: SamplerValues = { ...DEFAULT_SAMPLERS, top_k: 0, seed: -1, temperature: 1 };
        const { body } = buildTextRequest(request({ samplers: neutral }));
        // `top_k: 0` means "no limit" to one backend and "keep zero tokens" to
        // another; omitting it is the only reading everybody agrees on.
        expect(body.top_k).toBeUndefined();
        expect(body.seed).toBeUndefined();
        expect(body.temperature).toBeUndefined();
    });

    it('keeps a sampler that is merely small but not neutral', () => {
        const { body } = buildTextRequest(request({ samplers: { ...DEFAULT_SAMPLERS, top_k: 1 } }));
        expect(body.top_k).toBe(1);
    });

    it('drops a sampler set to something unusable', () => {
        const broken = { ...DEFAULT_SAMPLERS, temperature: Number.NaN };
        expect(buildTextRequest(request({ samplers: broken })).body.temperature).toBeUndefined();
    });
});

describe('buildTextRequest per-backend extras', () => {
    it('asks the Kobold route to abort on disconnect', () => {
        const { body } = buildTextRequest(request({ backend: 'kobold' }));
        expect(body.can_abort).toBe(true);
        // Without this the route would use the server's own GUI settings and
        // ignore the samplers entirely.
        expect(body.gui_settings).toBe(false);
    });

    it('passes stop strings under the name each route reads', () => {
        expect(buildTextRequest(request()).body.stop).toEqual(['\nUser:']);
        expect(buildTextRequest(request({ backend: 'kobold' })).body.stop_sequence).toEqual(['\nUser:']);
    });

    it('sends NovelAI stop sequences only once tokenised', () => {
        // Strings are silently ignored by NovelAI's API, which is why a
        // generation otherwise runs past where it should have stopped.
        expect(buildTextRequest(request({ backend: 'novel' })).body.stop_sequences).toBeUndefined();
        const tokenised = buildTextRequest(request({ backend: 'novel', stopTokens: [[1, 2], [3]] }));
        expect(tokenised.body.stop_sequences).toEqual([[1, 2], [3]]);
    });

    it('passes the Horde model preferences when the user picked some', () => {
        expect(buildTextRequest(request({ backend: 'horde' })).body.models).toBeUndefined();
        expect(buildTextRequest(request({ backend: 'horde', hordeModels: ['a'] })).body.models).toEqual(['a']);
    });

    it('reflects the streaming flag', () => {
        expect(buildTextRequest(request({ stream: true })).body.stream).toBe(true);
        expect(buildTextRequest(request({ backend: 'kobold', stream: true })).body.streaming).toBe(true);
        expect(buildTextRequest(request({ backend: 'novel', stream: true })).body.streaming).toBe(true);
    });
});

describe('extractTextResult', () => {
    it('reads the OpenAI completions shape', () => {
        expect(extractTextResult('ooba', { choices: [{ text: 'hello' }] })).toBe('hello');
    });

    it('reads a chat-shaped answer to a completions request', () => {
        expect(extractTextResult('generic', { choices: [{ message: { content: 'hello' } }] })).toBe('hello');
    });

    it('reads the llama.cpp shape', () => {
        expect(extractTextResult('llamacpp', { content: 'hello' })).toBe('hello');
    });

    it('reads the Kobold shape', () => {
        expect(extractTextResult('kobold', { results: [{ text: 'hello' }] })).toBe('hello');
    });

    it('reads the NovelAI shape', () => {
        expect(extractTextResult('novel', { output: 'hello' })).toBe('hello');
    });

    it('is empty rather than throwing on a shape it does not know', () => {
        expect(extractTextResult('ooba', null)).toBe('');
        expect(extractTextResult('ooba', {})).toBe('');
        expect(extractTextResult('kobold', { results: [] })).toBe('');
        expect(extractTextResult('ooba', { choices: [{}] })).toBe('');
    });
});

describe('extractTextDelta', () => {
    it('reads the OpenAI streaming shape', () => {
        expect(extractTextDelta('ooba', { choices: [{ text: 'to' }] }))
            .toEqual({ text: 'to', reasoning: '', done: false });
    });

    it('keeps the reasoning the Ollama route reports alongside the text', () => {
        expect(extractTextDelta('ollama', { choices: [{ text: 'a', thinking: 'hmm' }] }))
            .toEqual({ text: 'a', reasoning: 'hmm', done: false });
    });

    it('reads the Kobold and NovelAI token frames', () => {
        expect(extractTextDelta('kobold', { token: 'to' }).text).toBe('to');
        expect(extractTextDelta('novel', { token: 'to' }).text).toBe('to');
    });

    it('recognises the end of each stream', () => {
        expect(extractTextDelta('novel', { token: '', final: true }).done).toBe(true);
        expect(extractTextDelta('llamacpp', { content: '', stop: true }).done).toBe(true);
        expect(extractTextDelta('ooba', { choices: [{ text: '', finish_reason: 'stop' }] }).done).toBe(true);
        expect(extractTextDelta('ooba', { choices: [{ text: 'x', finish_reason: null }] }).done).toBe(false);
    });

    it('is empty rather than throwing on junk', () => {
        expect(extractTextDelta('ooba', null)).toEqual({ text: '', reasoning: '', done: false });
        expect(extractTextDelta('ooba', 'nonsense')).toEqual({ text: '', reasoning: '', done: false });
        expect(extractTextDelta('ooba', { choices: 'no' })).toEqual({ text: '', reasoning: '', done: false });
    });
});

describe('extractTextError', () => {
    it('reads a message', () => {
        expect(extractTextError({ error: { message: 'out of memory' } })).toBe('out of memory');
        expect(extractTextError({ error: 'out of memory' })).toBe('out of memory');
    });

    it('says something useful for the Kobold route\'s bare flag', () => {
        // `{ error: true }` is all that route gives the client; the reason
        // only exists in the server log.
        expect(extractTextError({ error: true })).toBe('');
        expect(extractTextError({ error: {} })).toContain('did not say');
    });

    it('is empty for a successful payload', () => {
        expect(extractTextError({ choices: [{ text: 'hi' }] })).toBe('');
        expect(extractTextError(null)).toBe('');
    });
});

describe('novelTokenizer', () => {
    it('picks the tokenizer each model needs', () => {
        expect(novelTokenizer('llama-3-erato-v1')).toBe('llama3');
        expect(novelTokenizer('kayra-v1')).toBe('nerdstash_v2');
        expect(novelTokenizer('clio-v1')).toBe('nerdstash');
    });

    it('falls back rather than sending an unencodable stop list', () => {
        expect(novelTokenizer('something-new')).toBe('llama3');
    });
});
