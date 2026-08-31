/**
 * Two builds of the same extension can sit in one browser at once: the copy the
 * packaged app stages, and one loaded straight from the repository for
 * development. Chrome lists both by name, and picking the wrong card is how a
 * developer reloads the operator's extension by mistake.
 *
 * The marker goes in front because Chrome truncates a long name in the card
 * list, and a suffix is exactly what disappears there.
 */
export type ExtensionChannel = 'release' | 'development'

export interface ExtensionManifest {
  readonly name: string
  readonly description: string
  readonly [field: string]: unknown
}

const DEVELOPMENT_NAME_PREFIX = '[개발용] '
const DEVELOPMENT_DESCRIPTION_SUFFIX = ' 저장소에서 직접 불러온 개발용 빌드입니다.'

/** Anything but an explicit development request builds what operators install. */
export function extensionChannel(value: string | undefined): ExtensionChannel {
  return value?.trim().toLowerCase() === 'development' ? 'development' : 'release'
}

export function applyExtensionChannel(manifest: ExtensionManifest, channel: ExtensionChannel): ExtensionManifest {
  if (channel === 'release') return manifest
  return {
    ...manifest,
    name: `${DEVELOPMENT_NAME_PREFIX}${manifest.name}`,
    description: `${manifest.description}${DEVELOPMENT_DESCRIPTION_SUFFIX}`,
  }
}
