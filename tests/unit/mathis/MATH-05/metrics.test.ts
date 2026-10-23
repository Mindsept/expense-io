import { expect, test } from 'vitest'
import { summarize } from '../../../../scripts/mathis/MATH-05/metrics.mjs'

test('retains HTTP errors and timeouts in the denominator and latency sample', () => {
  const result = summarize([{ms:10,ok:true},{ms:20,ok:false},{ms:1000,ok:false}])
  expect(result).toMatchObject({attempts:3,errors:2,errorRate:2/3,medianMs:20,maxMs:1000,p95Ms:null})
})
test('does not invent a percentile or rate for an empty sample', () => {
  expect(summarize([])).toEqual({attempts:0,errors:0,errorRate:null,medianMs:null,p95Ms:null})
})
test('computes an observed nearest-rank percentile only with an explicit adequate sample', () => {
  const rows = Array.from({length:100},(_,i)=>({ms:i+1,ok:true}))
  expect(summarize(rows)).toMatchObject({attempts:100,medianMs:50.5,p95Ms:95,errors:0})
})
