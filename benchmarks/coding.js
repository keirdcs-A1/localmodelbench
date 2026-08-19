/**
 * Coding battery. Scored by actually running the model's code against unit
 * tests in a separate process. No opinion involved: a test passes or it does not.
 *
 * Every task is a single pure JavaScript function so the code can be executed
 * safely without imports, filesystem or network access.
 */
export const battery = "coding";

export const cases = [
  // ---------------- easy ----------------
  {
    id: "code-fizzbuzz",
    tier: "easy",
    functionName: "fizzbuzz",
    prompt:
      "Write a JavaScript function `fizzbuzz(n)` that returns an array of length n. " +
      "For each number from 1 to n: return the string 'Fizz' if divisible by 3, 'Buzz' if divisible by 5, " +
      "'FizzBuzz' if divisible by both, otherwise the number itself as a number (not a string).",
    tests: [
      { call: "fizzbuzz(5)", expect: [1, 2, "Fizz", 4, "Buzz"] },
      { call: "fizzbuzz(15).slice(-1)", expect: ["FizzBuzz"] },
      { call: "fizzbuzz(0)", expect: [] },
    ],
  },
  {
    id: "code-titlecase",
    tier: "easy",
    functionName: "titleCase",
    prompt:
      "Write a JavaScript function `titleCase(str)` that capitalises the first letter of every word and " +
      "lowercases the rest. Words are separated by single spaces. An empty string returns an empty string.",
    tests: [
      { call: "titleCase('hello world')", expect: "Hello World" },
      { call: "titleCase('tHE quICK brown FOX')", expect: "The Quick Brown Fox" },
      { call: "titleCase('')", expect: "" },
    ],
  },

  // ---------------- medium ----------------
  {
    id: "code-parse-duration",
    tier: "medium",
    functionName: "parseDuration",
    prompt:
      "Write a JavaScript function `parseDuration(str)` that parses a duration string like '1h30m', '45m', " +
      "'2h', '90s' or '1h2m3s' and returns the total number of seconds as a number. " +
      "Units are h (hours), m (minutes), s (seconds) and may appear in any combination but always in that order. " +
      "Return null for anything it cannot parse, including an empty string.",
    tests: [
      { call: "parseDuration('1h30m')", expect: 5400 },
      { call: "parseDuration('45m')", expect: 2700 },
      { call: "parseDuration('1h2m3s')", expect: 3723 },
      { call: "parseDuration('90s')", expect: 90 },
      { call: "parseDuration('')", expect: null },
      { call: "parseDuration('banana')", expect: null },
    ],
  },
  {
    id: "code-group-by",
    tier: "medium",
    functionName: "groupBy",
    prompt:
      "Write a JavaScript function `groupBy(items, keyFn)` that groups an array of items into a plain object. " +
      "keyFn is a function returning the group key for an item. Preserve the original order within each group. " +
      "An empty array returns an empty object.",
    tests: [
      { call: "groupBy([1,2,3,4], n => n % 2 === 0 ? 'even' : 'odd')", expect: { odd: [1, 3], even: [2, 4] } },
      { call: "groupBy([], x => x)", expect: {} },
      { call: "groupBy(['apple','avocado','banana'], s => s[0])", expect: { a: ["apple", "avocado"], b: ["banana"] } },
    ],
  },
  {
    id: "code-merge-intervals",
    tier: "medium",
    functionName: "mergeIntervals",
    prompt:
      "Write a JavaScript function `mergeIntervals(intervals)` that takes an array of [start, end] number pairs " +
      "and merges any that overlap or touch. Return the merged intervals sorted by start. " +
      "For example [[1,3],[2,6],[8,10]] becomes [[1,6],[8,10]]. An empty array returns an empty array.",
    tests: [
      { call: "mergeIntervals([[1,3],[2,6],[8,10]])", expect: [[1, 6], [8, 10]] },
      { call: "mergeIntervals([[5,6],[1,2]])", expect: [[1, 2], [5, 6]] },
      { call: "mergeIntervals([[1,4],[4,5]])", expect: [[1, 5]] },
      { call: "mergeIntervals([])", expect: [] },
    ],
  },

  // ---------------- hard ----------------
  {
    id: "code-tokenise-csv",
    tier: "hard",
    functionName: "parseCsvLine",
    prompt:
      "Write a JavaScript function `parseCsvLine(line)` that splits a single CSV line into an array of field strings. " +
      "It must handle quoted fields containing commas, escaped double quotes inside quoted fields (written as two " +
      "double quotes), and empty fields. Surrounding quotes are stripped from the returned values. " +
      'For example: a,"b,c",,"d""e" returns ["a", "b,c", "", "d\\"e"].',
    tests: [
      { call: "parseCsvLine('a,b,c')", expect: ["a", "b", "c"] },
      { call: `parseCsvLine('a,"b,c",,"d""e"')`, expect: ["a", "b,c", "", 'd"e'] },
      { call: "parseCsvLine('')", expect: [""] },
      { call: `parseCsvLine('"just one"')`, expect: ["just one"] },
    ],
  },
  {
    id: "code-debounce-logic",
    tier: "hard",
    functionName: "compressRanges",
    prompt:
      "Write a JavaScript function `compressRanges(numbers)` that takes a sorted array of unique integers and " +
      "returns a compact string. Runs of three or more consecutive numbers become 'start-end'; anything else is " +
      "listed individually. Items are joined with a comma and no spaces. " +
      "For example [1,2,3,5,7,8,9,10] becomes '1-3,5,7-10'. An empty array returns an empty string.",
    tests: [
      { call: "compressRanges([1,2,3,5,7,8,9,10])", expect: "1-3,5,7-10" },
      { call: "compressRanges([1,2,4,5])", expect: "1,2,4,5" },
      { call: "compressRanges([])", expect: "" },
      { call: "compressRanges([9])", expect: "9" },
      { call: "compressRanges([-3,-2,-1,4])", expect: "-3--1,4" },
    ],
  },
  {
    id: "code-deep-equal",
    tier: "hard",
    functionName: "deepEqual",
    prompt:
      "Write a JavaScript function `deepEqual(a, b)` returning true if two values are deeply equal. " +
      "Handle primitives, arrays, plain objects, null, and NaN (NaN should equal NaN). " +
      "Objects with different key counts are not equal. Arrays and objects are never equal to each other.",
    tests: [
      { call: "deepEqual({a:1,b:[1,2]}, {b:[1,2],a:1})", expect: true },
      { call: "deepEqual([1,2], {0:1,1:2})", expect: false },
      { call: "deepEqual(NaN, NaN)", expect: true },
      { call: "deepEqual({a:1}, {a:1,b:2})", expect: false },
      { call: "deepEqual(null, undefined)", expect: false },
    ],
  },
];
