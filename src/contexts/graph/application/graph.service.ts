import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { Mutex } from "@shared/domain/mutex";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import {
  edgesOf,
  entitiesOf,
  neighborsOfKind,
  nodeKey,
  refOfKey,
  withNeighbor,
  type EntityKind,
  type NodeRecord,
} from "../domain/graph";
import type { GraphFeatures, GraphPort, Neighborhood } from "./graph.port";

/** Bounds the ring-size walk. On the decision path each hop is a store round-trip, so the
 *  live signal uses a tight cap (rules only threshold ringSize); the analyst endpoint walks further. */
const RING_CAP_HOT = 64;
const RING_CAP_FULL = 500;
/** Striped locks: a fixed pool so a node's read-modify-write serializes with itself (no lost
 *  updates) while different nodes still run concurrently — bounded memory, unlike a per-node map. */
const LOCK_STRIPES = 64;

@Injectable()
export class GraphService implements GraphPort {
  private readonly nodes: Collection<NodeRecord>;
  private readonly stripes = Array.from({ length: LOCK_STRIPES }, () => new Mutex());

  constructor(@Inject(STORE) store: Store) {
    this.nodes = store.collection<NodeRecord>("graph-nodes");
  }

  async observe(event: RiskEvent): Promise<void> {
    for (const [a, b] of edgesOf(entitiesOf(event))) {
      await this.addNeighbor(a, b);
      await this.addNeighbor(b, a);
    }
  }

  /** Serialize the load→modify→save for a node so concurrent observes can't clobber each other. */
  private addNeighbor(key: string, neighbor: string): Promise<void> {
    return this.lockFor(key).run(async () => {
      await this.nodes.put(key, withNeighbor(await this.nodes.get(key), neighbor));
    });
  }

  private lockFor(key: string): Mutex {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    return this.stripes[Math.abs(h) % LOCK_STRIPES];
  }

  async featuresFor(event: RiskEvent): Promise<GraphFeatures> {
    const userKey = nodeKey("user", event.subject.userId);
    const deviceNode = event.subject.deviceId ? await this.nodes.get(nodeKey("device", event.subject.deviceId)) : null;
    const ipNode = event.subject.ip ? await this.nodes.get(nodeKey("ip", event.subject.ip)) : null;
    const phoneNode = event.subject.phone ? await this.nodes.get(nodeKey("phone", event.subject.phone)) : null;
    const userNode = await this.nodes.get(userKey);
    return {
      usersOnDevice: neighborsOfKind(deviceNode, "user").length,
      usersOnIp: neighborsOfKind(ipNode, "user").length,
      usersOnPhone: neighborsOfKind(phoneNode, "user").length,
      devicesOnUser: neighborsOfKind(userNode, "device").length,
      ringSize: await this.componentSize(userKey, RING_CAP_HOT),
    };
  }

  async neighborhood(kind: EntityKind, id: string): Promise<Neighborhood> {
    const key = nodeKey(kind, id);
    const node = await this.nodes.get(key);
    const ids = (k: EntityKind) => neighborsOfKind(node, k).map((n) => refOfKey(n).id);
    return {
      kind,
      id,
      users: ids("user"),
      devices: ids("device"),
      ips: ids("ip"),
      phones: ids("phone"),
      ringSize: await this.componentSize(key, RING_CAP_FULL),
    };
  }

  async erase(kind: EntityKind, id: string): Promise<void> {
    const key = nodeKey(kind, id);
    const node = await this.nodes.get(key);
    if (!node) return;
    for (const other of node.neighbors) {
      const record = await this.nodes.get(other);
      if (record) await this.nodes.put(other, { neighbors: record.neighbors.filter((n) => n !== key) });
    }
    await this.nodes.delete(key);
  }

  /** BFS over the cluster containing `start`, bounded by `cap` store reads. */
  private async componentSize(start: string, cap: number): Promise<number> {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0 && seen.size < cap) {
      const node = await this.nodes.get(queue.shift() as string);
      for (const n of node?.neighbors ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen.size;
  }
}
