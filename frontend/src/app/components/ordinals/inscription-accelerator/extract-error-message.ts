/**
 * Extracts a human-readable error message from various error object structures.
 *
 * This function attempts to handle different formats of error objects that can be
 * encountered in an RxJS Observable error. It progressively checks for different
 * properties and types to find a meaningful error message. The checks are as follows:
 * 1. Direct string errors.
 * 2. Errors with an 'error.message' string.
 * 3. Errors where 'error' itself is a string.
 * 4. Errors with a 'message' string.
 * 5. Errors where 'error' is an object, attempting to stringify it.
 * 6. A generic error message as a last resort.
 *
 * @param {any} err - The error object to extract the message from. This can be of any type.
 * @returns {string} A string representing the most informative and safe-to-display error message.
 */
export function extractErrorMessage(err: any): string {

  // If err is a string, return it directly (simplest case)
  if (typeof err === 'string') {
    return err;
  }

  // If err.error is an object with a message property
  if (err.error && typeof err.error.message === 'string') {
    return err.error.message;
  }

  // If err.error is a string
  if (typeof err.error === 'string') {
    return err.error;
  }

  // If err has a message property
  if (typeof err.message === 'string') {
    return err.message;
  }

  // Handle cases where err.error is an object (without a message property)
  // Convert object to string, or use a generic message if conversion isn't meaningful
  if (typeof err.error === 'object') {
    return JSON.stringify(err.error) || 'An unknown error occurred in the error object';
  }

  // Final fallback for any other case
  return 'An unknown error occurred';
}
