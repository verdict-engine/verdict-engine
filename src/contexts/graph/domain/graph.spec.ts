import { describe, expect, it } from "vitest";
import type { EventId, UserId, DeviceId } from "@shared/domain/ids";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import { edgesOf, entitiesOf, neighborsOfKind, nodeKey, refOfKey, withNeighbor } from "./graph";

const event = (userId: string, deviceId?: string, ip?: string): RiskEvent => ({
  id: "evt" as EventId,
  type: "card.authorize",
  occurredAt: "2026-01-01T00:00:00Z",
  subject: { userId: userId as UserId, deviceId: deviceId as DeviceId | undefined, ip },
  attributes: {},
});

describe("graph domain", () => {
  it("extracts user, device and ip entities from an event", () => {
    expect(entitiesOf(event("u1", "d1", "1.2.3.4"))).toEqual([
      { kind: "user", id: "u1" },
      { kind: "device", id: "d1" },
      { kind: "ip", id: "1.2.3.4" },
    ]);
  });

  it("omits absent entities", () => {
    expect(entitiesOf(event("u1"))).toEqual([{ kind: "user", id: "u1" }]);
  });

  it("asserts an edge between every pair of entities", () => {
    const edges = edgesOf(entitiesOf(event("u1", "d1", "1.2.3.4")));
    expect(edges).toHaveLength(3);
    expect(edges).toContainEqual(["user:u1", "device:d1"]);
    expect(edges).toContainEqual(["device:d1", "ip:1.2.3.4"]);
  });

  it("adds neighbors without duplicating, kept sorted", () => {
    let node = withNeighbor(null, "user:u2");
    node = withNeighbor(node, "user:u1");
    node = withNeighbor(node, "user:u2");
    expect(node.neighbors).toEqual(["user:u1", "user:u2"]);
  });

  it("filters neighbors by kind", () => {
    const node = { neighbors: ["user:u1", "user:u2", "device:d1"] };
    expect(neighborsOfKind(node, "user")).toEqual(["user:u1", "user:u2"]);
    expect(neighborsOfKind(node, "device")).toEqual(["device:d1"]);
  });

  it("round-trips a node key", () => {
    expect(refOfKey(nodeKey("ip", "1.2.3.4"))).toEqual({ kind: "ip", id: "1.2.3.4" });
  });
});
