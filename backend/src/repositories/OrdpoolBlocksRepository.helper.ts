/**
 * Parses a compact activity string into a key-value map.
 *
 * @param data - The compact activity string, where each key-value pair is formatted as "key1,value1,key2,value2,...".
 * @returns An object with keys mapped to numeric values.
 *
 * Example:
 * Input: "840686:2338,1,876937:1691,3113"
 * Output: { "840686:2338": 1, "876937:1691": 3113 }
 */
export function parseActivity(data: string | null): { [key: string]: number } {
  if (!data) {
    return {};
  }
  const result: { [key: string]: number } = {};
  const items = data.split(',');
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i];
    const value = parseInt(items[i + 1], 10);
    result[key] = value;
  }
  return result;
}

/**
 * Parses a compact attempts string into a key-to-array map.
 *
 * @param data - The compact attempts string, where each key-value pair is formatted as "key1,value1,key2,value2,...".
 * @returns An object where each key maps to an array of associated values.
 *
 * Example:
 * Input: "840686:2338,txid1,876937:1691,txid2"
 * Output: { "840686:2338": ["txid1"], "876937:1691": ["txid2"] }
 */
export function parseAttempts(data: string | null): { [key: string]: string[] } {
  if (!data) {
    return {};
  }
  const result: { [key: string]: string[] } = {};
  const items = data.split(',');
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i];
    const value = items[i + 1];
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }
  return result;
}
