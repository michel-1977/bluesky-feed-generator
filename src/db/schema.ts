export type DatabaseSchema = {
  post: Post
  sub_state: SubState
}

export type Post = {
  uri: string
  cid: string
  author: string
  text: string
  langs: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
