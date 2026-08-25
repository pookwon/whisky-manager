import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The one file Chrome insists on seeing directly inside a loaded folder. */
const MANIFEST = 'manifest.json'

/**
 * Makes `target` hold exactly what `source` holds.
 *
 * Overwriting in place rather than wiping first is deliberate: once the
 * operator has loaded this folder as an unpacked extension, Chrome remembers
 * it by path, and a folder that briefly goes missing is a folder Chrome can
 * report as broken. Nothing is ever removed that the source still has.
 *
 * Directory contents are read by name and classified with `stat`, not with
 * `withFileTypes`. In a packaged build the source lives inside the asar
 * archive, and this is the reading Electron's asar layer answers everywhere.
 */
export function mirrorDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true })

  const wanted = new Map(
    readdirSync(source).map((name) => [name, statSync(join(source, name)).isDirectory()]),
  )

  // Stale entries go first, including one whose kind changed — a file may not
  // be copied over a directory of the same name.
  for (const name of readdirSync(target)) {
    const isDirectoryInSource = wanted.get(name)
    if (isDirectoryInSource === statSync(join(target, name)).isDirectory()) continue
    rmSync(join(target, name), { recursive: true, force: true })
  }

  for (const [name, isDirectory] of wanted) {
    const from = join(source, name)
    const to = join(target, name)
    if (isDirectory) mirrorDirectory(from, to)
    else copyFileSync(from, to)
  }
}

/**
 * Puts the extension that ships inside this app somewhere Chrome can load it
 * from, and answers with that folder.
 *
 * Chrome cannot read an unpacked extension out of the app bundle — on Windows
 * it sits inside `app.asar`, which is an archive rather than a directory — so
 * the copy is what makes "압축해제된 확장 프로그램을 로드" possible at all. It
 * also removes the download-and-unzip step from the operator's side entirely.
 *
 * The destination is stable across runs on purpose. Chrome derives an unpacked
 * extension's id from its path, so a folder that moved would be a different
 * extension, and the pairing already made would no longer be honoured.
 */
export function stageExtension(sourceDir: string, targetDir: string): string {
  if (!existsSync(join(sourceDir, MANIFEST))) {
    // Failing here names the real fault. Left alone, the operator would open an
    // empty folder and meet Chrome's "manifest.json을 찾을 수 없습니다" instead,
    // which points at them rather than at the build that shipped incomplete.
    throw new Error(`확장 파일을 찾지 못했습니다: ${join(sourceDir, MANIFEST)}`)
  }

  mirrorDirectory(sourceDir, targetDir)
  return targetDir
}
