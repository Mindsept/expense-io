import { beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import {
  noAliases, readPrivateConfig, newOutputDirectory, writeNewJson,
  schemaDigest, toolingDigest, privateRoot, root, sha256,
} from '../../../scripts/mathis/MATH-06/guards.mjs'

const fs = vi.hoisted(() => ({ stat: vi.fn(), read: vi.fn(), list: vi.fn(), mkdir: vi.fn(), write: vi.fn() }))
vi.mock('node:fs/promises', () => ({ lstat: fs.stat, readFile: fs.read, readdir: fs.list, mkdir: fs.mkdir, writeFile: fs.write }))
const configFile = path.join(privateRoot, 'unit-config.json')
beforeEach(() => {
  vi.resetAllMocks()
  fs.stat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 64, mode: 0o600 })
  fs.read.mockResolvedValue('{"project":"isolated"}')
})

it('reads only an absolute, regular private configuration', async () => {
  expect(await readPrivateConfig(configFile)).toEqual({ project: 'isolated' })
  expect(fs.read).toHaveBeenCalledWith(configFile, 'utf8')
  for (const file of ['', 'relative.json']) {
    await expect(readPrivateConfig(file)).rejects.toThrow('absolute_private_config_required')
  }
})

it.each(['link', 'directory', 'oversized', 'denied', 'invalid-json'])('refuses unsafe configuration: %s', async fault => {
  if (fault === 'link') fs.stat.mockResolvedValue({ isSymbolicLink: () => true })
  if (fault === 'directory' || fault === 'oversized') {
    fs.stat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => fault !== 'directory', size: 65537, mode: 0o600 })
  }
  if (fault === 'denied') fs.stat.mockRejectedValue(Object.assign(new Error('access denied'), { code: 'EACCES' }))
  if (fault === 'invalid-json') fs.read.mockResolvedValue('not json')
  await expect(readPrivateConfig(configFile)).rejects.toThrow(
    fault === 'link' ? 'symbolic_path_refused' : fault === 'denied' ? 'access denied' : fault === 'invalid-json' ? /JSON/ : 'private_config_permissions',
  )
  if (fault !== 'invalid-json') expect(fs.read).not.toHaveBeenCalled()
})

it('accepts a new path but never ignores filesystem errors other than absence', async () => {
  fs.stat.mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }))
  expect(await noAliases(configFile)).toBe(configFile)
  fs.stat.mockRejectedValue(Object.assign(new Error('disk failure'), { code: 'EIO' }))
  await expect(noAliases(configFile)).rejects.toThrow('disk failure')
})

it('creates a fresh output under the private root and refuses overwrite', async () => {
  const output = path.join(privateRoot, 'new-archive')
  expect(await newOutputDirectory(output)).toBe(output)
  expect(fs.mkdir.mock.calls).toEqual([
    [privateRoot, { recursive: true, mode: 0o700 }],
    [output, { mode: 0o700 }],
  ])
  fs.mkdir.mockRejectedValue(Object.assign(new Error('already exists'), { code: 'EEXIST' }))
  await expect(newOutputDirectory(output)).rejects.toThrow('already exists')
})

it.each(['', 'relative', privateRoot, path.resolve(privateRoot, '..', 'outside')])('refuses an output outside its owned directory: %s', async file => {
  await expect(newOutputDirectory(file)).rejects.toThrow(/absolute_output_required|output_must_be_inside_ignored_math06_directory/)
  expect(fs.mkdir).not.toHaveBeenCalled()
})

it('writes private JSON exclusively and propagates an existing-file refusal', async () => {
  await writeNewJson(configFile, { ready: true })
  expect(fs.write).toHaveBeenCalledWith(configFile, '{\n  "ready": true\n}\n', { flag: 'wx', mode: 0o600 })
  fs.write.mockRejectedValue(new Error('exists'))
  await expect(writeNewJson(configFile, {})).rejects.toThrow('exists')
})

it('hashes migrations in filename order and includes names to distinguish equal contents', async () => {
  fs.list.mockResolvedValue(['b.sql', 'notes.md', 'a.sql'])
  fs.read.mockImplementation(async (file: string) => Buffer.from(path.basename(file)))
  expect(await schemaDigest()).toBe(sha256(Buffer.from('a.sql\0a.sqlb.sql\0b.sql')))
  expect(fs.read.mock.calls.map(([file]) => path.basename(file))).toEqual(['a.sql', 'b.sql'])
})

it('binds the tooling digest to scripts, package metadata and compose configuration', async () => {
  fs.list.mockResolvedValue(['z.mjs', 'README.md', 'a.mjs'])
  fs.read.mockImplementation(async (file: string) => Buffer.from(path.basename(file)))
  const digest = await toolingDigest()
  expect(digest).toBe(sha256(Buffer.from('a.mjs\0a.mjsz.mjs\0z.mjspackage.jsondocker-compose.test.yml')))
  expect(fs.read).toHaveBeenCalledWith(path.join(root, 'package.json'))
  fs.read.mockImplementation(async (file: string) => Buffer.from(path.basename(file) === 'package.json' ? 'changed dependency' : path.basename(file)))
  expect(await toolingDigest()).not.toBe(digest)
})
