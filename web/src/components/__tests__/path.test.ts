import { describe, expect, it } from 'vitest'
import { baseName, dirName, splitPath } from '@/utils/path.ts'

describe('splitPath', () => {
  it('splits unix path by /', () => {
    expect(splitPath('/home/user/project')).toEqual(['', 'home', 'user', 'project'])
  })

  it('splits windows path by \\', () => {
    expect(splitPath('C:\\Users\\admin\\file.txt')).toEqual(['C:', 'Users', 'admin', 'file.txt'])
  })

  it('splits mixed separators', () => {
    expect(splitPath('a/b\\c')).toEqual(['a', 'b', 'c'])
  })

  it('handles single segment', () => {
    expect(splitPath('file.txt')).toEqual(['file.txt'])
  })

  it('handles empty string', () => {
    expect(splitPath('')).toEqual([''])
  })

  it('handles root path /', () => {
    expect(splitPath('/')).toEqual(['', ''])
  })

  it('handles consecutive slashes', () => {
    expect(splitPath('a//b')).toEqual(['a', '', 'b'])
  })

  it('handles path with only separators', () => {
    expect(splitPath('/\\')).toEqual(['', '', ''])
  })
})

describe('baseName', () => {
  it('returns filename from unix path', () => {
    expect(baseName('/home/user/file.go')).toBe('file.go')
  })

  it('returns filename from windows path', () => {
    expect(baseName('C:\\Users\\admin\\file.txt')).toBe('file.txt')
  })

  it('returns last segment for directory path without trailing slash', () => {
    expect(baseName('/home/user/project')).toBe('project')
  })

  it('returns segment for single segment', () => {
    expect(baseName('file.txt')).toBe('file.txt')
  })

  it('handles path with trailing slash', () => {
    const result = baseName('/home/user/')
    expect(result).toBe('/home/user/')
  })

  it('handles root path', () => {
    expect(baseName('/')).toBe('/')
  })

  it('handles dot files', () => {
    expect(baseName('.gitignore')).toBe('.gitignore')
  })

  it('handles hidden file in directory', () => {
    expect(baseName('/home/user/.bashrc')).toBe('.bashrc')
  })

  it('handles multiple extensions', () => {
    expect(baseName('/path/to/archive.tar.gz')).toBe('archive.tar.gz')
  })
})

describe('dirName', () => {
  it('returns parent directory from unix path', () => {
    expect(dirName('/home/user/file.go')).toBe('/home/user')
  })

  it('returns parent directory from windows path', () => {
    expect(dirName('C:\\Users\\admin\\file.txt')).toBe('C:\\Users\\admin')
  })

  it('returns drive root for file in drive root', () => {
    expect(dirName('C:\\file.txt')).toBe('C:\\')
  })

  it('returns empty for single segment', () => {
    expect(dirName('file.txt')).toBe('')
  })

  it('handles unix root path', () => {
    expect(dirName('/file.txt')).toBe('')
  })

  it('handles nested paths', () => {
    expect(dirName('/a/b/c/d')).toBe('/a/b/c')
  })

  it('handles windows paths with backslash separator', () => {
    expect(dirName('a\\b\\c')).toBe('a\\b')
  })

  it('handles deeply nested unix path', () => {
    expect(dirName('/a/b/c/d/e/f')).toBe('/a/b/c/d/e')
  })

  it('handles path with only two segments', () => {
    expect(dirName('/file')).toBe('')
  })

  it('handles dot file dirName', () => {
    expect(dirName('/home/user/.bashrc')).toBe('/home/user')
  })

  it('handles path with mixed separators (uses forward slash by default)', () => {
    // Mixed paths use / as join since path includes /
    expect(dirName('a/b\\c')).toBe('a/b')
  })
})
