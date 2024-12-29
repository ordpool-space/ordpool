/**
 * Parses a comma-separated string of JSON objects into a single key-value map.
 *
 * Compatible with the following tables:
 * - ordpool_stats_rune_mint_activity
 * - ordpool_stats_brc20_mint_activity
 * - ordpool_stats_src20_mint_activity
 *
 * **Example Input (be aware that GROUP_CONCAT does not output brackets):**
 * ```
 * {"identifier":"key1","value":123},{"identifier":"key2","value":456}
 * ```
 *
 * **Parsed Output:**
 * ```ts
 * { key1: 123, key2: 456 }
 * ```
 *
 * @template V - The type of the value field in the resulting object.
 * @param data - A JSON-like string in the format `{"keyField": ..., "valueField": ...}`.
 * @param keyField - The field name to use as the key in the resulting object (must always be a string).
 * @param valueField - The field name to use as the value in the resulting object.
 * @returns An object where each key is the value of `keyField` and maps to the value of `valueField`.
 */
export function parseKeyValueMap<V>(
  data: string | null,
  keyField: string,
  valueField: string
): { [key: string]: V } {
  if (!data) {
    return {};
  }

  return JSON.parse(`[${data}]`).reduce((acc, item) => {
    const key = item[keyField];
    const value = item[valueField];

    if (typeof key === 'string') {
      acc[key] = value as V;
    }

    return acc;
  }, {} as { [key: string]: V });
}

/**
 * Parses a comma-separated string of JSON objects into a map of key to array of values.
 * Compatible with the following tables:
 * - ordpool_stats_rune_etch
 * - ordpool_stats_brc20_deploy
 * - ordpool_stats_src20_deploy
 *
 * **Example Input (be aware that GROUP_CONCAT does not output brackets):**
 * ```
 * {"identifier":"key1","txid":"tx1"},{"identifier":"key1","txid":"tx2"},{"identifier":"key2","txid":"tx3"}
 * ```
 *
 * **Parsed Output:**
 * ```ts
 * {
 *   key1: ["tx1", "tx2"],
 *   key2: ["tx3"]
 * }
 * ```
 *
  * @template V - The type of the elements in the arrays in the resulting object.
 * @param data - A JSON-like string in the format `{"keyField": ..., "valueField": ...}`.
 * @param keyField - The field name to use as the key in the resulting object (must always be a string).
 * @param valueField - The field name to use as the value in the resulting object.
 * @returns An object where each key is the value of `keyField` and maps to an array of `valueField` values.
 */
export function parseKeyToArrayMap<V>(
  data: string | null,
  keyField: string,
  valueField: string
): { [key: string]: V[] } {
  if (!data) {
    return {};
  }

  return JSON.parse(`[${data}]`).reduce((acc, item) => {
    const key = item[keyField];
    const value = item[valueField];

    if (typeof key === 'string') {
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(value as V);
    }

    return acc;
  }, {} as { [key: string]: V[] });
}

