import { limitArray } from './limit-array';

describe('limitArray', () => {
  it('should return the first N elements if the array has more than N elements', () => {
    const array = [1, 2, 3, 4, 5];
    const N = 3;
    const result = limitArray(array, N);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should return the input array if it has less than N elements', () => {
    const array = [1, 2, 3];
    const N = 5;
    const result = limitArray(array, N);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should return the input array if it has exactly N elements', () => {
    const array = [1, 2, 3, 4, 5];
    const N = 5;
    const result = limitArray(array, N);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});
