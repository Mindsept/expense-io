import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), configure: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { constructor(config: unknown) { mocks.configure(config) } send = mocks.send },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.send.mockResolvedValue({}); mocks.sign.mockResolvedValue('https://storage.example.test/private?signature=synthetic') })
afterEach(() => vi.unstubAllEnvs())
it('uploads, signs and removes a receipt with one configured private S3 client', async () => {
  for (const [key, value] of Object.entries({ S3_BUCKET: 'private', S3_ENDPOINT: 'http://127.0.0.1:4566', S3_REGION: 'eu-west-1', S3_FORCE_PATH_STYLE: 'false', S3_ACCESS_KEY_ID: 'synthetic-access', S3_SECRET_ACCESS_KEY: 'synthetic-secret' })) vi.stubEnv(key, value)
  const storage = await import('@/lib/storage'), data = Buffer.from('synthetic receipt')
  await storage.uploadReceipt('receipts/id.pdf', data, 'application/pdf')
  expect(mocks.send.mock.calls[0][0].input).toEqual({ Bucket: 'private', Key: 'receipts/id.pdf', Body: data, ContentType: 'application/pdf' })
  expect(await storage.getReceiptUrl('receipts/id.pdf', 60)).toContain('signature=synthetic')
  expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: { Bucket: 'private', Key: 'receipts/id.pdf' } }), { expiresIn: 60 })
  await storage.removeReceipt('receipts/id.pdf')
  expect(mocks.send.mock.calls[1][0].input).toEqual({ Bucket: 'private', Key: 'receipts/id.pdf' })
  expect(mocks.send.mock.calls[1][1].abortSignal).toBeInstanceOf(AbortSignal)
  expect(mocks.configure).toHaveBeenCalledExactlyOnceWith({ endpoint: 'http://127.0.0.1:4566', region: 'eu-west-1', forcePathStyle: false, credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' } })
})
it('uses bounded signing defaults and propagates storage failures', async () => {
  for (const key of ['S3_BUCKET', 'S3_REGION', 'S3_FORCE_PATH_STYLE', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) vi.stubEnv(key, undefined)
  const storage = await import('@/lib/storage')
  await storage.getReceiptUrl('receipt')
  expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: { Bucket: 'receipts', Key: 'receipt' } }), { expiresIn: 300 })
  expect(mocks.configure).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: '', secretAccessKey: '' } }))
  mocks.send.mockRejectedValue(new Error('storage unavailable'))
  await expect(storage.uploadReceipt('receipt', Buffer.from('x'), 'image/png')).rejects.toThrow('storage unavailable')
  await expect(storage.removeReceipt('receipt')).rejects.toThrow('storage unavailable')
})
