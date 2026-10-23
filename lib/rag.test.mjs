import { expect, test } from 'vitest'
import { similar } from './rag.mjs'

// One chunk per file is enough: a file's vector is its chunks averaged.
const file = (...vecs) => ({ hash: '', chunks: vecs.map((vec) => ({ text: '', vec })) })

test('pairs files that read alike above the threshold, each pair once', () => {
  const files = { 'a.md': file([1, 0]), 'b.md': file([0.99, 0.14]), 'c.md': file([0, 1]) }
  const pairs = similar(0.9, 3, files)
  expect(pairs.map((p) => [p.a, p.b])).toEqual([['a.md', 'b.md']])
  expect(pairs[0].score).toBeCloseTo(0.99, 2)
})

test("averages a file's chunks and keeps each file's k closest", () => {
  const files = {
    'hub.md': file([1, 0], [1, 0]),
    'x.md': file([1, 0.05]), 'y.md': file([1, 0.1]), 'z.md': file([1, 0.3]),
  }
  const pairs = similar(0.5, 1, files).map((p) => `${p.a} ${p.b}`).sort()
  // hub keeps only x; y and z still keep their own nearest.
  expect(pairs).toEqual(['hub.md x.md', 'x.md y.md', 'y.md z.md'])
})
