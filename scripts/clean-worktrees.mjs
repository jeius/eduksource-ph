/**
 * Runs `pnpm clean` in every directory under .dev/worktrees/
 *
 * Usage:
 *   node clean-worktrees.js
 *
 * Options (env vars):
 *   WORKTREES_DIR   Override the worktrees directory (default: .dev/worktrees)
 *   DRY_RUN=1       Print what would run without actually running it
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const worktreesDir = path.resolve(process.env.WORKTREES_DIR || '.dev/worktrees')
const dryRun = process.env.DRY_RUN === '1'

function main() {
  if (!fs.existsSync(worktreesDir)) {
    console.error(`Worktrees directory not found: ${worktreesDir}`)
    process.exit(1)
  }

  const entries = fs.readdirSync(worktreesDir, { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(worktreesDir, entry.name))

  if (dirs.length === 0) {
    console.log(`No subdirectories found under ${worktreesDir}`)
    return
  }

  console.log(
    `Found ${dirs.length} worktree director${dirs.length === 1 ? 'y' : 'ies'} under ${worktreesDir}\n`
  )

  const results = []

  for (const dir of dirs) {
    const label = path.relative(process.cwd(), dir)
    console.log(`==> ${label}`)

    if (dryRun) {
      console.log('    (dry run) would execute: pnpm clean')
      results.push({ dir: label, status: 'skipped (dry run)' })
      continue
    }

    const pkgJsonPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) {
      console.log('    skipped: no package.json found')
      results.push({ dir: label, status: 'skipped (no package.json)' })
      continue
    }

    const result = spawnSync('pnpm', ['clean'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    if (result.error) {
      console.error(`    error: ${result.error.message}`)
      results.push({ dir: label, status: 'error' })
    } else if (result.status !== 0) {
      console.error(`    failed with exit code ${result.status}`)
      results.push({ dir: label, status: `failed (exit ${result.status})` })
    } else {
      results.push({ dir: label, status: 'success' })
    }

    console.log('')
  }

  console.log('Summary:')
  for (const { dir, status } of results) {
    console.log(`  ${status.padEnd(24)} ${dir}`)
  }

  const hasFailures = results.some((r) => r.status.startsWith('failed') || r.status === 'error')
  if (hasFailures) process.exitCode = 1
}

main()
