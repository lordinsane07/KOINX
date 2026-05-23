/* eslint-disable no-bitwise */
// ---------------------------------------------------------------------------
// binarySearch.js — Binary search utilities for sorted numeric arrays.
// Used by the fuzzy matcher to efficiently find candidate records within
// a timestamp tolerance window, turning an O(n) scan into O(log n).
// ---------------------------------------------------------------------------

/**
 * Find the index of the first element in `sortedArray` that is ≥ `target`.
 *
 * If all elements are less than `target`, returns `sortedArray.length`
 * (one past the end), which is the correct insertion point.
 *
 * @param {number[]} sortedArray — A numeric array sorted in ascending order.
 * @param {number} target        — The value to search for.
 * @returns {number}             — The index of the first element ≥ target.
 *
 * @example
 * binarySearchLower([10, 20, 30, 40, 50], 25)  // → 2  (first element ≥ 25 is 30 at index 2)
 * binarySearchLower([10, 20, 30], 5)            // → 0  (all elements ≥ 5)
 * binarySearchLower([10, 20, 30], 35)           // → 3  (no element ≥ 35)
 */
export function binarySearchLower(sortedArray, target) {
  let lo = 0;
  let hi = sortedArray.length;

  while (lo < hi) {
    // Unsigned right shift avoids overflow on very large indices
    const mid = (lo + hi) >>> 1;

    if (sortedArray[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}

/**
 * Find the index of the last element in `sortedArray` that is ≤ `target`.
 *
 * If all elements are greater than `target`, returns `-1`.
 *
 * @param {number[]} sortedArray — A numeric array sorted in ascending order.
 * @param {number} target        — The value to search for.
 * @returns {number}             — The index of the last element ≤ target, or -1.
 *
 * @example
 * binarySearchUpper([10, 20, 30, 40, 50], 25)  // → 1  (last element ≤ 25 is 20 at index 1)
 * binarySearchUpper([10, 20, 30], 35)           // → 2  (last element ≤ 35 is 30 at index 2)
 * binarySearchUpper([10, 20, 30], 5)            // → -1 (no element ≤ 5)
 */
export function binarySearchUpper(sortedArray, target) {
  let lo = 0;
  let hi = sortedArray.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (sortedArray[mid] <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first index where element > target, so lo - 1 is the last ≤ target
  return lo - 1;
}
