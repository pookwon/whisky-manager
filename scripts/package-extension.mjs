import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const version = process.env.npm_package_version ?? '0.1.0'
const outputDir = resolve('release')
const output = join(outputDir, `Whisky-Manager-${version}-Chrome-Extension.zip`)

mkdirSync(outputDir, { recursive: true })
rmSync(output, { force: true })

if (process.platform === 'win32') {
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path 'dist/extension/*' -DestinationPath '${output}'`,
  ], { stdio: 'inherit' })
} else {
  execFileSync('zip', ['-qr', output, '.'], { cwd: 'dist/extension', stdio: 'inherit' })
}

console.log(`Created ${output}`)
