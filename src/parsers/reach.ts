/** The `name@version` of what each kind of install brings in */
export interface InstallSets {
  production: Set<string>
  dev: Set<string>
}

export interface LockNode {
  /** The `name@version` this node installs */
  id: string
  /** Keys of the nodes it depends on */
  deps: string[]
}

/**
 * Collects what a set of roots installs.
 *
 * Nodes are single resolved lockfile entries rather than names. A name can have
 * a production copy and a dev-only copy at different versions, and edges keyed
 * by name made each one inherit the other's status.
 * @param {string[]} roots Keys of the nodes to start from; unknown keys are ignored.
 * @param {ReadonlyMap<string, LockNode>} nodes Every node, by key.
 * @returns {Set<string>} The `name@version` of each node reached.
 */
export function reach(roots: string[], nodes: ReadonlyMap<string, LockNode>): Set<string> {
  const visited = new Set<string>()
  const reached = new Set<string>()
  const queue = [...roots]
  for (const key of queue) {
    const node = nodes.get(key)
    if (typeof node === 'undefined' || visited.has(key)) continue
    visited.add(key)
    reached.add(node.id)
    queue.push(...node.deps)
  }
  return reached
}
