/**
 * Shared error type for the image generation providers.
 */

/**
 * An error carrying the upstream detail, so the client can be told *why* a
 * generation failed instead of just that it did.
 *
 * The provider modules throw this instead of a bare `Error` and the route
 * turns it into a response the UI can show verbatim; previously a failed
 * render came back as an empty 500 and the reason only existed in the server
 * log.
 */
export class ImageGenerationError extends Error {
    /**
     * @param {string} message Human-readable reason
     * @param {object} [options] Extra context
     * @param {string} [options.provider] Provider id
     * @param {number} [options.upstreamStatus] HTTP status the provider returned
     * @param {unknown} [options.detail] Parsed upstream body, when useful
     */
    constructor(message, { provider, upstreamStatus, detail } = {}) {
        super(message);
        this.name = 'ImageGenerationError';
        this.provider = provider;
        this.upstreamStatus = upstreamStatus;
        this.detail = detail;
    }
}
