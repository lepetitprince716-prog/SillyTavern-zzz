import { describe, test, expect, jest, beforeAll } from '@jest/globals';

// These modules reach for the config file and the secrets store at import
// time, neither of which exists in a unit test.
jest.unstable_mockModule('../src/util.js', () => ({
    delay: () => Promise.resolve(),
    getBasicAuthHeader: () => undefined,
    tryParse: (str) => { try { return JSON.parse(str); } catch { return undefined; } },
    extractFileFromZipBuffer: () => Promise.resolve(null),
}));

jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    SECRET_KEYS: { NOVEL: 'api_key_novel' },
    readSecret: () => '',
}));

/** @type {import('../src/images/comfyui.js')} */
let comfy;
/** @type {import('../src/images/novelai.js')} */
let novelai;
/** @type {import('../src/images/errors.js')} */
let errors;

beforeAll(async () => {
    comfy = await import('../src/images/comfyui.js');
    novelai = await import('../src/images/novelai.js');
    errors = await import('../src/images/errors.js');
});

describe('substituteWorkflow', () => {
    test('replaces a string placeholder with a JSON string', () => {
        const workflow = '{"text": "%prompt%"}';
        expect(comfy.substituteWorkflow(workflow, { prompt: 'a cat' })).toBe('{"text": "a cat"}');
    });

    test('replaces a numeric placeholder with a bare number', () => {
        // This is the whole point of the quoted form: a template can carry
        // both `"%steps%"` -> 28 and `"%prompt%"` -> "a cat".
        expect(comfy.substituteWorkflow('{"steps": "%steps%"}', { steps: 28 })).toBe('{"steps": 28}');
    });

    test('escapes quotes and newlines in a value', () => {
        const result = comfy.substituteWorkflow('{"t": "%prompt%"}', { prompt: 'say "hi"\nplease' });
        expect(result).toBe('{"t": "say \\"hi\\"\\nplease"}');
        expect(() => JSON.parse(result)).not.toThrow();
    });

    test('replaces every occurrence', () => {
        const result = comfy.substituteWorkflow('["%seed%","%seed%"]', { seed: 7 });
        expect(result).toBe('[7,7]');
    });

    test('leaves an unknown placeholder untouched', () => {
        // Emptying it would produce a subtly wrong render rather than a clear
        // failure, so an unfilled placeholder stays visible.
        expect(comfy.substituteWorkflow('{"x": "%mystery%"}', { prompt: 'a' })).toBe('{"x": "%mystery%"}');
    });

    test('writes null for an explicitly undefined value', () => {
        expect(comfy.substituteWorkflow('{"x": "%vae%"}', { vae: undefined })).toBe('{"x": null}');
    });

    test('does not expand a placeholder that appears inside a value', () => {
        // Single pass: workflow data must not be able to inject more
        // substitutions.
        const result = comfy.substituteWorkflow('{"t": "%prompt%"}', {
            prompt: '"%seed%"',
            seed: 42,
        });
        expect(result).toBe('{"t": "\\"%seed%\\""}');
    });

    test('handles a false or zero value without dropping it', () => {
        expect(comfy.substituteWorkflow('{"a": "%on%", "b": "%n%"}', { on: false, n: 0 }))
            .toBe('{"a": false, "b": 0}');
    });

    test('returns an empty string for a non-string workflow', () => {
        expect(comfy.substituteWorkflow(null, {})).toBe('');
    });
});

describe('findWorkflowPlaceholders', () => {
    test('lists the placeholders a workflow declares, without duplicates', () => {
        const workflow = '{"a": "%prompt%", "b": "%seed%", "c": "%prompt%"}';
        expect(comfy.findWorkflowPlaceholders(workflow)).toEqual(['prompt', 'seed']);
    });

    test('is empty for a workflow with none', () => {
        expect(comfy.findWorkflowPlaceholders('{"a": 1}')).toEqual([]);
    });

    test('tolerates a non-string workflow', () => {
        expect(comfy.findWorkflowPlaceholders(undefined)).toEqual([]);
    });
});

describe('findWorkflowOutput', () => {
    test('finds an image output', () => {
        const item = { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } };
        expect(comfy.findWorkflowOutput(item)?.filename).toBe('a.png');
    });

    test('falls back to an animation output', () => {
        const item = { outputs: { '9': { gifs: [{ filename: 'a.webp' }] } } };
        expect(comfy.findWorkflowOutput(item)?.filename).toBe('a.webp');
    });

    test('prefers an image when both are present', () => {
        const item = { outputs: { '9': { gifs: [{ filename: 'a.webp' }], images: [{ filename: 'b.png' }] } } };
        expect(comfy.findWorkflowOutput(item)?.filename).toBe('b.png');
    });

    test('returns null when a node produced nothing recognisable', () => {
        expect(comfy.findWorkflowOutput({ outputs: { '9': { text: ['hello'] } } })).toBeNull();
        expect(comfy.findWorkflowOutput({})).toBeNull();
        expect(comfy.findWorkflowOutput(null)).toBeNull();
    });
});

describe('describeWorkflowFailure', () => {
    test('renders one line per failing node', () => {
        const item = {
            status: {
                messages: [
                    ['execution_start', {}],
                    ['execution_error', {
                        node_type: 'KSampler',
                        node_id: '3',
                        exception_type: 'RuntimeError',
                        exception_message: 'out of memory',
                    }],
                ],
            },
        };
        expect(comfy.describeWorkflowFailure(item)).toBe('KSampler [3] RuntimeError: out of memory');
    });

    test('is empty when there is nothing to report', () => {
        expect(comfy.describeWorkflowFailure({ status: { messages: [] } })).toBe('');
        expect(comfy.describeWorkflowFailure({})).toBe('');
    });
});

describe('ImageGenerationError', () => {
    test('carries the provider and upstream status', () => {
        const error = new errors.ImageGenerationError('nope', { provider: 'novelai', upstreamStatus: 402 });
        expect(error.message).toBe('nope');
        expect(error.provider).toBe('novelai');
        expect(error.upstreamStatus).toBe(402);
        expect(error).toBeInstanceOf(Error);
    });
});

describe('resolveSeed', () => {
    test('keeps a seed that was asked for', () => {
        expect(novelai.resolveSeed(1234)).toBe(1234);
        expect(novelai.resolveSeed('1234')).toBe(1234);
        expect(novelai.resolveSeed(0)).toBe(0);
    });

    test('rolls one when the request asks for random', () => {
        expect(novelai.resolveSeed(-1, () => 0.5)).toBe(4999999999);
        expect(novelai.resolveSeed(undefined, () => 0)).toBe(0);
    });

    test('rolls one for an unusable value', () => {
        expect(novelai.resolveSeed('not a number', () => 0.25)).toBe(2499999999);
    });

    test('stays inside NovelAI\'s accepted range', () => {
        for (const roll of [0, 0.5, 0.999999]) {
            const seed = novelai.resolveSeed(-1, () => roll);
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThan(10_000_000_000);
            expect(Number.isInteger(seed)).toBe(true);
        }
    });
});

describe('calculateSkipCfgAboveSigma', () => {
    test('is the base multiplier at the reference size', () => {
        expect(novelai.calculateSkipCfgAboveSigma(832, 1216, 'nai-diffusion-3')).toBeCloseTo(19, 5);
    });

    test('uses the larger multiplier for V4.5 models', () => {
        expect(novelai.calculateSkipCfgAboveSigma(832, 1216, 'nai-diffusion-4-5-full')).toBeCloseTo(58, 5);
    });

    test('scales with the square root of the pixel count', () => {
        const reference = novelai.calculateSkipCfgAboveSigma(832, 1216, 'nai-diffusion-3');
        const doubled = novelai.calculateSkipCfgAboveSigma(832 * 2, 1216, 'nai-diffusion-3');
        expect(doubled / reference).toBeCloseTo(Math.SQRT2, 5);
    });

    test('does not throw on a missing model name', () => {
        expect(novelai.calculateSkipCfgAboveSigma(512, 512, undefined)).toBeGreaterThan(0);
    });
});

describe('buildNovelAiBody', () => {
    const params = {
        prompt: 'a quiet glade',
        negativePrompt: 'blurry',
        width: 832,
        height: 1216,
        steps: 23,
        cfgScale: 5.5,
        sampler: 'k_euler_ancestral',
        scheduler: 'native',
        model: 'nai-diffusion-4-5-full',
    };

    test('maps the normalised parameters onto NovelAI\'s payload', () => {
        const body = novelai.buildNovelAiBody(params, 4242);
        expect(body.action).toBe('generate');
        expect(body.input).toBe('a quiet glade');
        expect(body.model).toBe('nai-diffusion-4-5-full');
        expect(body.parameters.negative_prompt).toBe('blurry');
        expect(body.parameters.width).toBe(832);
        expect(body.parameters.height).toBe(1216);
        expect(body.parameters.steps).toBe(23);
        expect(body.parameters.scale).toBe(5.5);
        expect(body.parameters.sampler).toBe('k_euler_ancestral');
        expect(body.parameters.noise_schedule).toBe('native');
    });

    test('uses the seed it was handed rather than rolling its own', () => {
        expect(novelai.buildNovelAiBody(params, 4242).parameters.seed).toBe(4242);
    });

    test('mirrors the prompt into the V4 caption fields', () => {
        const body = novelai.buildNovelAiBody(params, 1);
        expect(body.parameters.v4_prompt.caption.base_caption).toBe('a quiet glade');
        expect(body.parameters.v4_negative_prompt.caption.base_caption).toBe('blurry');
    });

    test('leaves the Variety+ cutoff null unless asked for', () => {
        expect(novelai.buildNovelAiBody(params, 1).parameters.skip_cfg_above_sigma).toBeNull();
        const boosted = novelai.buildNovelAiBody({ ...params, varietyBoost: true }, 1);
        expect(boosted.parameters.skip_cfg_above_sigma).toBeCloseTo(58, 5);
    });

    test('passes the SMEA and decrisper toggles through', () => {
        const body = novelai.buildNovelAiBody({ ...params, sm: true, smDyn: true, decrisper: true }, 1);
        expect(body.parameters.sm).toBe(true);
        expect(body.parameters.sm_dyn).toBe(true);
        expect(body.parameters.dynamic_thresholding).toBe(true);
    });

    test('fills sensible defaults for an almost-empty request', () => {
        const body = novelai.buildNovelAiBody({ prompt: 'x' }, 9);
        expect(body.parameters.width).toBe(512);
        expect(body.parameters.height).toBe(512);
        expect(body.parameters.steps).toBe(28);
        expect(body.parameters.scale).toBe(9);
        expect(body.parameters.sampler).toBe('k_dpmpp_2m');
        expect(body.parameters.noise_schedule).toBe('karras');
        expect(body.parameters.negative_prompt).toBe('');
        expect(body.model).toBe('nai-diffusion');
    });
});
