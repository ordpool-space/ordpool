/**
 * Returns an array that contains the first N elements of the input array.
 * If the input array has less than N elements, it returns the input array.
 *
 * @param {T[]} array - The input array.
 * @param {number} N - The number of elements to keep.
 * @return {T[]} The array containing the first N elements of the input array.
 * @template T
 */
export function limitArray<T>(array: T[], N: number): T[] {
  return array.length > N ? array.slice(0, N) : array;
}
