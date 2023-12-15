/**
 * Decodes a data URI into its original content.
 *
 * This function parses a data URI, extracting the MIME type and the Base64 encoded data.
 * It then decodes the data appropriately based on the MIME type. Text-based formats
 * (including 'text/' types and 'image/svg+xml') are decoded as UTF-8 text.
 * Other formats are treated as binary and returned as a binary string.
 *
 * This method is also included (and tested) in ordpool-parser
 */
export function decodeDataURI(uri) {
  const match = uri.match(/^data:([^,]+);base64,(.*)$/);
  if (!match || !match[2]) {
    throw new Error('Invalid data URI format');
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const binaryStr = atob(base64Data);

  if (mimeType.startsWith('text/') || mimeType === 'image/svg+xml') {
    // For text-based formats and SVG, convert binary string to UTF-8
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } else {
    // For other formats, return binary string or handle as needed
    return binaryStr;
  }
}
