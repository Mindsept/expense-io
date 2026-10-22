/** Include every attempt, including timeouts and non-2xx responses. */
export function summarize(samples) {
  if (!samples.length) return { attempts: 0, errors: 0, errorRate: null, medianMs: null, p95Ms: null }
  const values = samples.map(row => row.ms).sort((a,b) => a-b)
  const errors = samples.filter(row => !row.ok).length
  return { attempts: samples.length, errors, errorRate: errors/samples.length,
    medianMs: values.length%2 ? values[(values.length-1)/2] : (values[values.length/2-1]+values[values.length/2])/2,
    p95Ms: values.length >= 30 ? values[Math.ceil(values.length*.95)-1] : null,
    minMs: values[0], maxMs: values.at(-1) }
}
