import { HandleResolver } from '@atproto/identity'
import { TRUSTED_AUTHOR_DIDS, TRUSTED_AUTHOR_HANDLES } from './spec'

export const resolveTrustedAuthorDids = async (): Promise<Set<string>> => {
  const dids = new Set<string>(TRUSTED_AUTHOR_DIDS)
  const resolver = new HandleResolver({ timeout: 5000 })

  await Promise.all(
    TRUSTED_AUTHOR_HANDLES.map(async (handle) => {
      try {
        const did = await resolver.resolve(handle)
        if (did) {
          dids.add(did)
        } else {
          console.warn(`Could not resolve trusted handle: ${handle}`)
        }
      } catch (err) {
        console.warn(`Failed to resolve trusted handle ${handle}`, err)
      }
    }),
  )

  return dids
}
