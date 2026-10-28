import { afterEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { demoSettings } from '../../../scripts/mathis/MATH-03/settings.mjs'
import { sendDemo, ensureDemoBucket, checkDemoBucket, healthyDemoObject, putDemoObject, removeDemoObject, DEMO_PNG, DEMO_HASH } from '../../../scripts/mathis/MATH-03/storage.mjs'

const settings = demoSettings({
  SEED_DEMO_ENV: 'local-test', SEED_CONFIRM_DATABASE: 'expense_io_test',
  SEED_ADMIN_DATABASE_URL: 'postgres://expense_test:synthetic@127.0.0.1:55440/expense_io_test',
  S3_ENDPOINT: 'http://127.0.0.1:45740', S3_BUCKET: 'receipts-ci-test',
  S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test',
  SEED_HR_EMAIL: 'hr@expense.test', SEED_MANAGER_EMAIL: 'manager@expense.test', SEED_EMPLOYEE_EMAIL: 'employee@expense.test',
})
const key = 'receipts/known.png'
const absent = { $metadata: { httpStatusCode: 404 } }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('never sends a storage request after the operation deadline', async () => {
  const send = vi.fn()
  await expect(sendDemo({ send }, {}, Date.now() - 1)).rejects.toThrow('storage_deadline')
  expect(send).not.toHaveBeenCalled()
})

it('returns an existing bucket without recreating it and handles a concurrent creation', async () => {
  const send = vi.fn().mockResolvedValue({})
  expect(await ensureDemoBucket(settings, { send })).toEqual({ bucket: 'existing' })
  expect(send).toHaveBeenCalledOnce()
  send.mockClear().mockRejectedValueOnce(absent).mockRejectedValueOnce({ name: 'BucketAlreadyOwnedByYou' })
  expect(await ensureDemoBucket(settings, { send })).toEqual({ bucket: 'ready' })
  expect(send).toHaveBeenCalledTimes(3)
})

it('does not hide an unexpected bucket creation failure', async () => {
  const error = new Error('creation failed'), send = vi.fn().mockRejectedValueOnce(absent).mockRejectedValueOnce(error)
  await expect(ensureDemoBucket(settings, { send })).rejects.toBe(error)
  expect(send).toHaveBeenCalledTimes(2)
})

it.each([404, 403])('distinguishes a missing bucket from permission denial (%s)', async status => {
  const send = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: status } })
  await expect(checkDemoBucket(settings, { send })).rejects.toThrow(status === 404 ? 'bucket_missing_run_ensure_bucket' : 'storage_access_denied')
  expect(send).toHaveBeenCalledOnce()
})

it('treats only a missing object as repairable', async () => {
  const send = vi.fn().mockRejectedValue(absent)
  expect(await healthyDemoObject(settings, { send }, key)).toBe(false)
  const error = new Error('unexpected transport failure'); send.mockRejectedValue(error)
  await expect(healthyDemoObject(settings, { send }, key)).rejects.toBe(error)
})

it.each(['missing-body', 'oversized', 'changed'])('rejects invalid content despite a valid HEAD: %s', async fault => {
  const body = fault === 'oversized' ? Buffer.concat([DEMO_PNG, Buffer.from('extra')]) : Buffer.alloc(DEMO_PNG.length)
  const stream = Readable.from([body])
  const send = vi.fn().mockResolvedValueOnce({ ContentLength: DEMO_PNG.length, ContentType: 'image/png' })
    .mockResolvedValueOnce(fault === 'missing-body' ? {} : { Body: stream })
  await expect(healthyDemoObject(settings, { send }, key)).rejects.toThrow(fault === 'missing-body' ? 'storage_payload_missing' : 'unexpected_demo_object')
  if (fault !== 'missing-body') expect(stream.destroyed).toBe(true)
})

it('times out a stalled receipt body and destroys its stream', async () => {
  vi.useFakeTimers()
  const stream = new Readable({ read() {} })
  const send = vi.fn().mockResolvedValueOnce({ ContentLength: DEMO_PNG.length, ContentType: 'image/png' }).mockResolvedValueOnce({ Body: stream })
  const checked = expect(healthyDemoObject(settings, { send }, key, Date.now() + 50)).rejects.toThrow('storage_deadline')
  await vi.advanceTimersByTimeAsync(50)
  await checked
  expect(stream.destroyed).toBe(true)
})

it('creates a marked receipt conditionally and deletes exactly the requested object', async () => {
  const send = vi.fn().mockResolvedValue({})
  await putDemoObject(settings, { send }, key)
  expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand)
  expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: settings.bucket, Key: key, IfNoneMatch: '*', Body: DEMO_PNG, Metadata: { sha256: DEMO_HASH } })
  await removeDemoObject(settings, { send }, key)
  expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand)
  expect(send.mock.calls[1][0].input).toEqual({ Bucket: settings.bucket, Key: key })
})

it.each([true, false])('checks concurrent object creation before accepting it (exists=%s)', async exists => {
  const send = vi.fn().mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } })
  if (exists) send.mockResolvedValueOnce({ ContentLength: DEMO_PNG.length, ContentType: 'image/png' }).mockResolvedValueOnce({ Body: Readable.from([DEMO_PNG]) })
  else send.mockRejectedValueOnce(absent)
  const put = putDemoObject(settings, { send }, key)
  if (exists) await expect(put).resolves.toBeUndefined()
  else await expect(put).rejects.toThrow('object_race')
  expect(send.mock.calls.filter(([command]) => command instanceof PutObjectCommand)).toHaveLength(1)
})

it('preserves non-conflict write errors instead of attempting a read or retry', async () => {
  const error = new Error('write failed'), send = vi.fn().mockRejectedValue(error)
  await expect(putDemoObject(settings, { send }, key)).rejects.toBe(error)
  expect(send).toHaveBeenCalledOnce()
})
