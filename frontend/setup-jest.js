// Adds support for TextEncoder and TextDecoder
// see https://stackoverflow.com/a/68468204
// see https://github.com/jsdom/jsdom/issues/2524

// It patches the global objects TextEncoder, TextDecoder, and Uint8Array
// which are missing, or improperly implemented (Uint8Array is a node Buffer) in the JSDOM environment.
// This should ensure full compatibility with browser global objects in our Jest testing environment.

const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

// add this too
global.Uint8Array = Uint8Array;
